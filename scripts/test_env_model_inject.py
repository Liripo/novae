"""Ephemeral integration test: EnvModelConfigMiddleware injects the
.env-configured chat model into session/schedule creation requests that
lack one, never overwrites an explicit config, and the built-in agent
seed contains exactly the single bio expert (legacy ids retired)."""
import os
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

ENV_MODEL = os.environ["NOVAE_MODEL"]
EXPECTED_INJECTED = {
    "type": "openai_credential",
    "credential_id": server_module.ENV_CREDENTIAL_ID,
    "model": ENV_MODEL,
    "parameters": {},
}

app = server_module.create_fastapi_app()

with TestClient(app) as client:
    # login (also seeds the env credential the injected config references)
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    print("login OK")

    # --- built-in agents: bio + flow, legacy ids retired ------------------
    r = client.get("/agent/", headers=headers)
    assert r.status_code == 200, r.text
    agents = {a["id"]: a["data"]["name"] for a in r.json()["agents"]}
    for legacy in ("scrna", "rnaseq", "bioflow", "novae", "novae_optimizer"):
        assert legacy not in agents, agents
    assert agents == {"bio": "生信分析专家", "flow": "生信流程工程师"}, agents
    print("builtin bio agents OK:", agents)

    agent_id = "bio"

    # --- session WITHOUT chat_model_config -> injected --------------------
    r = client.post(
        "/sessions/",
        headers=headers,
        json={"agent_id": agent_id, "workspace_id": "w1", "name": "无配置会话"},
    )
    assert r.status_code == 201, r.text
    sid1 = r.json()["session_id"]
    r = client.get("/sessions/", headers=headers, params={"agent_id": agent_id})
    cfg1 = [s for s in r.json()["sessions"] if s["session"]["id"] == sid1][0]["session"]["config"]
    assert cfg1["chat_model_config"] == EXPECTED_INJECTED, cfg1
    print("session without config -> injected OK")

    # --- session WITH chat_model_config: null -> injected -----------------
    r = client.post(
        "/sessions/",
        headers=headers,
        json={
            "agent_id": agent_id,
            "workspace_id": "w2",
            "name": "null配置会话",
            "chat_model_config": None,
        },
    )
    assert r.status_code == 201, r.text
    sid2 = r.json()["session_id"]
    r = client.get("/sessions/", headers=headers, params={"agent_id": agent_id})
    cfg2 = [s for s in r.json()["sessions"] if s["session"]["id"] == sid2][0]["session"]["config"]
    assert cfg2["chat_model_config"] == EXPECTED_INJECTED, cfg2
    print("session with null config -> injected OK")

    # --- session WITH explicit config -> NOT overwritten ------------------
    explicit = {
        "type": "openai_credential",
        "credential_id": server_module.ENV_CREDENTIAL_ID,
        "model": "user-chosen-model",
        "parameters": {"temperature": 0.5},
    }
    r = client.post(
        "/sessions/",
        headers=headers,
        json={
            "agent_id": agent_id,
            "workspace_id": "w3",
            "name": "显式配置会话",
            "chat_model_config": explicit,
        },
    )
    assert r.status_code == 201, r.text
    sid3 = r.json()["session_id"]
    r = client.get("/sessions/", headers=headers, params={"agent_id": agent_id})
    cfg3 = [s for s in r.json()["sessions"] if s["session"]["id"] == sid3][0]["session"]["config"]
    assert cfg3["chat_model_config"] == explicit, cfg3
    print("explicit session config -> preserved OK")

    # --- schedule WITHOUT chat_model_config -> injected --------------------
    r = client.post(
        "/schedule/",
        headers=headers,
        json={
            "name": "每日报告",
            "cron_expression": "17 9 * * *",
            "agent_id": agent_id,
        },
    )
    assert r.status_code in (200, 201), r.text
    schedule_id = r.json().get("schedule_id")
    r = client.get("/schedule/", headers=headers)
    assert r.status_code == 200, r.text
    sched = [s for s in r.json()["schedules"] if s["id"] == schedule_id][0]
    assert sched["data"]["chat_model_config"] == EXPECTED_INJECTED, sched["data"]
    print("schedule without config -> injected OK")

# Cleanup: drop any workspace dirs the sessions/schedules above created.
for wid in ("w1", "w2", "w3"):
    shutil.rmtree(
        Path(server_module.cfg.workspace_root) / "admin" / wid,
        ignore_errors=True,
    )

print("ALL ENV-MODEL-INJECT CHECKS PASSED")
