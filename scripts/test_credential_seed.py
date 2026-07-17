"""Ephemeral integration test: verify the .env-managed credential is
seeded on startup and refreshed on every login (idempotent, fixed id)."""
import os

import fakeredis
import fakeredis.aioredis
import redis.asyncio as aioredis
from fastapi.testclient import TestClient

# Ensure .env provides a key; if missing, inject a dummy one for the test.
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy")
os.environ.setdefault("OPENAI_BASE_URL", "https://api.example.com/v1")

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
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    print("login OK")

    r = client.get("/credential/", headers=headers)
    assert r.status_code == 200, r.text
    creds = r.json()["credentials"]
    env_creds = [c for c in creds if c["id"] == server_module.ENV_CREDENTIAL_ID]
    assert len(env_creds) == 1, f"expected one env credential, got {creds}"
    data = env_creds[0]["data"]
    assert data["type"] == "openai_credential", data
    assert data["name"] == "系统默认", data
    assert data.get("base_url") == os.environ["OPENAI_BASE_URL"], data
    print("env credential seeded on login OK:", data["name"], data["type"])

    # Login again -> still exactly one record (upsert in place, no duplicates)
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    r = client.get("/credential/", headers=headers)
    creds = [c for c in r.json()["credentials"] if c["id"] == server_module.ENV_CREDENTIAL_ID]
    assert len(creds) == 1, "re-login must not duplicate the env credential"
    print("re-login idempotent OK")

    # Model listing for the credential type works (may fail upstream w/o real key;
    # just assert the route exists and responds, not 404)
    r = client.get("/model/", headers=headers, params={"credential_type": "openai_credential"})
    print("GET /model/ status:", r.status_code)
    assert r.status_code != 404

print("ALL CREDENTIAL-SEED CHECKS PASSED")
