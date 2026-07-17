"""Ephemeral integration test: run the Novae app on fakeredis and exercise
the /projects routes end-to-end (login -> create project -> session bound
to project -> file tree/content -> cascade delete)."""
import asyncio
import json
import os
import shutil
import tempfile

import fakeredis
import fakeredis.aioredis
import redis.asyncio as aioredis
from fastapi.testclient import TestClient

import novae.server as server_module
from novae.config import get_config

# --- Patch Redis-backed pieces onto a shared fake server -------------------
fake_server = fakeredis.FakeServer()


def _fake_redis_factory(*args, **kwargs):
    """Drop real-connection kwargs and return a FakeRedis on the shared server."""
    kwargs.pop("connection_pool", None)
    kwargs.pop("host", None)
    kwargs.pop("port", None)
    kwargs.pop("db", None)
    kwargs.pop("password", None)
    kwargs["decode_responses"] = True
    return fakeredis.aioredis.FakeRedis(server=fake_server, **kwargs)


# RedisStorage / RedisMessageBus / novae lifespan all construct clients via
# ``redis.asyncio.Redis`` (or the AsyncRedis alias in novae.server).
aioredis.Redis = _fake_redis_factory
server_module.AsyncRedis = _fake_redis_factory

cfg = get_config()
workspaces = cfg.workspace_root
print(f"workspace_root = {workspaces}")

app = server_module.create_fastapi_app()

with TestClient(app) as client:
    # health
    r = client.get("/health")
    assert r.status_code == 200, r.text
    print("GET /health ->", r.json())

    # login
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("login OK")

    # auth required
    r = client.get("/projects/")
    assert r.status_code == 401, r.status_code
    print("GET /projects/ without token -> 401 OK")

    # empty list
    r = client.get("/projects/", headers=headers)
    assert r.status_code == 200 and r.json()["projects"] == [], r.text
    print("GET /projects/ empty OK")

    # find the seeded builtin agent
    r = client.get("/agent/", headers=headers)
    assert r.status_code == 200, r.text
    agents = r.json()["agents"]
    assert agents, "expected at least the seeded builtin agent"
    agent_id = agents[0]["id"]
    print("agent:", agents[0]["data"]["name"], agent_id)

    # create project with a bogus agent -> 404
    r = client.post(
        "/projects/",
        headers=headers,
        json={"name": "x", "agent_id": "nope"},
    )
    assert r.status_code == 404, r.status_code
    print("POST /projects/ bad agent -> 404 OK")

    # create project
    r = client.post(
        "/projects/",
        headers=headers,
        json={"name": "测试项目", "description": "demo", "agent_id": agent_id},
    )
    assert r.status_code == 201, r.text
    project = r.json()
    pid = project["id"]
    print("POST /projects/ -> 201", pid)

    # list sorted by updated_at desc
    r = client.get("/projects/", headers=headers)
    assert r.status_code == 200 and r.json()["total"] == 1

    # rename
    r = client.patch(f"/projects/{pid}", headers=headers, json={"name": "改名项目"})
    assert r.status_code == 200 and r.json()["name"] == "改名项目", r.text
    print("PATCH rename OK")

    # not-owned / unknown project -> 404
    r = client.patch("/projects/deadbeef", headers=headers, json={"name": "x"})
    assert r.status_code == 404, r.status_code
    print("PATCH unknown project -> 404 OK")

    # create a session bound to the project
    r = client.post(
        "/sessions/",
        headers=headers,
        json={"agent_id": agent_id, "workspace_id": pid, "name": "项目会话"},
    )
    assert r.status_code == 201, r.text
    session_id = r.json()["session_id"]
    r = client.get("/sessions/", headers=headers, params={"agent_id": agent_id})
    sess = [s for s in r.json()["sessions"] if s["session"]["id"] == session_id][0]
    assert sess["session"]["config"]["workspace_id"] == pid
    print("session bound to project OK")

    # simulate files in the project workdir
    workdir = workspaces / "admin" / pid
    (workdir / "src").mkdir(parents=True, exist_ok=True)
    (workdir / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
    (workdir / "note.md").write_text("# 笔记\n中文内容\n", encoding="utf-8")
    (workdir / "bin.dat").write_bytes(b"\x00\x01\x02")
    (workdir / ".git").mkdir(exist_ok=True)

    r = client.get(f"/projects/{pid}/files", headers=headers)
    assert r.status_code == 200, r.text
    names = [n["name"] for n in r.json()["tree"]]
    assert names == ["src", "bin.dat", "note.md"], names
    print("files tree OK:", json.dumps(r.json()["tree"], ensure_ascii=False))

    r = client.get(f"/projects/{pid}/files/content", headers=headers, params={"path": "note.md"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content"].replace("\r\n", "\n") == "# 笔记\n中文内容\n" and body["truncated"] is False
    print("file content OK")

    r = client.get(f"/projects/{pid}/files/content", headers=headers, params={"path": "src/main.py"})
    assert r.status_code == 200 and "hello" in r.json()["content"]
    print("nested file content OK")

    # binary -> 415
    r = client.get(f"/projects/{pid}/files/content", headers=headers, params={"path": "bin.dat"})
    assert r.status_code == 415, r.status_code
    print("binary file -> 415 OK")

    # traversal -> 400
    for bad in ("../server.py", "..\\..\\pyproject.toml", "/abs/path", "C:\\x"):
        r = client.get(f"/projects/{pid}/files/content", headers=headers, params={"path": bad})
        assert r.status_code == 400, (bad, r.status_code)
    print("path traversal -> 400 OK")

    # missing file -> 404
    r = client.get(f"/projects/{pid}/files/content", headers=headers, params={"path": "nope.txt"})
    assert r.status_code == 404, r.status_code
    print("missing file -> 404 OK")

    # delete project: session cascade + workdir removal
    r = client.delete(f"/projects/{pid}", headers=headers)
    assert r.status_code == 204, r.status_code
    r = client.get("/sessions/", headers=headers, params={"agent_id": agent_id})
    remaining = [s for s in r.json()["sessions"] if s["session"]["id"] == session_id]
    assert not remaining, "session should be cascade-deleted"
    assert not workdir.exists(), "workdir should be removed"
    r = client.get("/projects/", headers=headers)
    assert r.json()["total"] == 0
    print("DELETE cascade OK")

print("ALL INTEGRATION CHECKS PASSED")
