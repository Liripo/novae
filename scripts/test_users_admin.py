"""Ephemeral integration test: admin-only user management routes.

Covers: no token -> 401, non-admin -> 403, admin lists users, admin
creates a user (201), duplicate username -> 409, invalid username -> 422,
the created user can log in and already has the env credential seeded at
creation time (verified in storage before first login)."""
import asyncio
import os

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
    # --- no token -> 401 ---------------------------------------------------
    r = client.get("/users/")
    assert r.status_code == 401, r.status_code
    r = client.post("/users/", json={"username": "x", "password": "y"})
    assert r.status_code == 401, r.status_code
    print("no token -> 401 OK")

    # --- admin login -------------------------------------------------------
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    admin_headers = {"Authorization": f"Bearer {r.json()['token']}"}
    print("admin login OK")

    # --- admin creates a normal user --------------------------------------
    r = client.post(
        "/users/",
        headers=admin_headers,
        json={"username": "alice", "password": "alice-pw", "role": "user"},
    )
    assert r.status_code == 201, r.text
    assert r.json() == {"username": "alice", "role": "user"}, r.json()
    print("admin create user -> 201 OK")

    # --- duplicate -> 409 --------------------------------------------------
    r = client.post(
        "/users/",
        headers=admin_headers,
        json={"username": "alice", "password": "whatever", "role": "user"},
    )
    assert r.status_code == 409, r.status_code
    print("duplicate username -> 409 OK")

    # --- invalid username -> 422 -------------------------------------------
    r = client.post(
        "/users/",
        headers=admin_headers,
        json={"username": "bad/name", "password": "x", "role": "user"},
    )
    assert r.status_code == 422, r.status_code
    print("invalid username -> 422 OK")

    # --- creation-time env credential seed (before alice's first login) ----
    cred = asyncio.run(
        app.state.storage.get_credential("alice", server_module.ENV_CREDENTIAL_ID)
    )
    assert cred is not None, "env credential must be seeded at user creation"
    print("env credential seeded at creation OK")

    # --- non-admin -> 403 --------------------------------------------------
    r = client.post("/auth/login", json={"username": "alice", "password": "alice-pw"})
    assert r.status_code == 200, r.text
    alice_headers = {"Authorization": f"Bearer {r.json()['token']}"}
    assert r.json()["role"] == "user", r.json()
    r = client.get("/users/", headers=alice_headers)
    assert r.status_code == 403, r.status_code
    r = client.post(
        "/users/",
        headers=alice_headers,
        json={"username": "mallory", "password": "x", "role": "admin"},
    )
    assert r.status_code == 403, r.status_code
    print("non-admin -> 403 OK")

    # --- new user can log in and has the env credential --------------------
    r = client.get("/credential/", headers=alice_headers)
    assert r.status_code == 200, r.text
    env_creds = [
        c for c in r.json()["credentials"] if c["id"] == server_module.ENV_CREDENTIAL_ID
    ]
    assert len(env_creds) == 1, r.json()
    print("new user login + env credential OK")

    # --- admin lists users --------------------------------------------------
    r = client.get("/users/", headers=admin_headers)
    assert r.status_code == 200, r.text
    users = {u["username"]: u["role"] for u in r.json()["users"]}
    assert users.get("admin") == "admin" and users.get("alice") == "user", users
    print("admin list users OK:", users)

print("ALL USER-MANAGEMENT CHECKS PASSED")
