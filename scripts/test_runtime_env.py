"""Ephemeral integration test: the runtime-env agent middleware factory
(``extra_agent_middlewares``) resolves the session's project workdir and
its ``on_system_prompt`` hook appends a 「## 运行环境」 section containing
OS info and the workdir absolute path. Unknown sessions yield no
middleware."""
import asyncio
import os
import platform
import shutil
from pathlib import Path

import fakeredis
import fakeredis.aioredis
import redis.asyncio as aioredis
from fastapi.testclient import TestClient

# Ensure .env provides values; if missing, inject dummies for the test.
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy")
os.environ.setdefault("OPENAI_BASE_URL", "https://api.example.com/v1")
os.environ.setdefault("NOVAE_MODEL", "env-test-model")

import novae.server as server_module  # noqa: E402

fake_server = fakeredis.FakeServer()


def _fake_redis_factory(*args, **kwargs):
    kwargs.pop("connection_pool", None)
    for k in ("host", "port", "db", "password"):
        kwargs.pop(k, None)
    kwargs["decode_responses"] = True
    return fakeredis.aioredis.FakeRedis(server=fake_server, **kwargs)


aioredis.Redis = _fake_redis_factory
server_module.AsyncRedis = _fake_redis_factory

app = server_module.create_fastapi_app()

with TestClient(app) as client:
    # login (also seeds the env credential + builtin agent)
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    print("login OK")

    # Create a project-bound session (workspace_id "w1").
    r = client.post(
        "/sessions/",
        headers=headers,
        json={"agent_id": "bio", "workspace_id": "w1", "name": "运行环境测试会话"},
    )
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]
    print("session created OK:", sid)

    factory = app.state.extra_agent_middlewares
    assert factory is not None, "extra_agent_middlewares not registered"

    # Known session -> exactly one RuntimeEnvMiddleware carrying the workdir.
    mws = asyncio.run(factory("admin", "bio", sid))
    assert len(mws) == 1, mws
    expected_workdir = str(
        (Path(server_module.cfg.workspace_root).resolve() / "admin" / "w1")
    )

    prompt = asyncio.run(mws[0].on_system_prompt(None, "BASE_PROMPT"))
    assert prompt.startswith("BASE_PROMPT"), prompt
    assert "## 运行环境" in prompt, prompt
    assert "操作系统" in prompt, prompt
    assert platform.system() in prompt or (
        platform.system() == "Darwin" and "macOS" in prompt
    ), prompt
    assert expected_workdir in prompt, (expected_workdir, prompt)
    if platform.system() == "Windows":
        assert "Git Bash" in prompt and "C:\\" in prompt, prompt
    print("on_system_prompt injects OS + workdir OK")
    print("---- injected section sample ----")
    print(prompt[len("BASE_PROMPT"):])
    print("---------------------------------")

    # Unknown session -> no middleware (never raises).
    assert asyncio.run(factory("admin", "bio", "nosuchsession")) == []
    # Unsafe path components -> no middleware.
    assert asyncio.run(factory("ad/min", "bio", sid)) == []
    print("unknown session / unsafe id -> [] OK")

# Cleanup: drop any workspace dir created for the test session.
shutil.rmtree(
    Path(server_module.cfg.workspace_root) / "admin" / "w1",
    ignore_errors=True,
)

print("ALL RUNTIME-ENV CHECKS PASSED")
