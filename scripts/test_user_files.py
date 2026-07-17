"""Ephemeral integration test: user workspace file browsing routes.

Covers: GET /files/ returns the tree of ``workspace_root/<user>/`` (with
project directories at the top level, auto-created when missing), nested
file content reads, path traversal -> 400, binary file -> 415, missing
file -> 404, absolute path -> 400. Project files routes keep working via
the same shared helpers (regression covered by test_projects_e2e.py)."""
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

app = server_module.create_fastapi_app()
user_root = Path(server_module.cfg.workspace_root).resolve() / "admin"

with TestClient(app) as client:
    # --- no token -> 401 ----------------------------------------------------
    r = client.get("/files/")
    assert r.status_code == 401, r.status_code
    print("no token -> 401 OK")

    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    print("login OK")

    # --- layout: a project dir with a nested text file + a binary file -----
    nested = user_root / "proj1" / "results" / "tables"
    nested.mkdir(parents=True, exist_ok=True)
    (nested / "degs.tsv").write_text("gene\tlog2fc\nTP53\t2.1\n", encoding="utf-8")
    (user_root / "proj1" / "raw.bin").write_bytes(b"\x00\x01\x02")

    # --- tree contains the project directory --------------------------------
    r = client.get("/files/", headers=headers)
    assert r.status_code == 200, r.text
    tree = r.json()["tree"]
    top = {n["name"]: n for n in tree}
    assert "proj1" in top and top["proj1"]["type"] == "dir", tree
    print("workspace tree contains project dir OK")

    # --- nested file content -------------------------------------------------
    r = client.get(
        "/files/content",
        headers=headers,
        params={"path": "proj1/results/tables/degs.tsv"},
    )
    assert r.status_code == 200, r.text
    assert "TP53" in r.json()["content"], r.json()
    assert r.json()["truncated"] is False, r.json()
    print("nested file content OK")

    # --- traversal / absolute -> 400 -----------------------------------------
    r = client.get("/files/content", headers=headers, params={"path": "../secret.txt"})
    assert r.status_code == 400, r.status_code
    r = client.get("/files/content", headers=headers, params={"path": "C:/Windows/win.ini"})
    assert r.status_code == 400, r.status_code
    print("path traversal / absolute -> 400 OK")

    # --- binary -> 415 ---------------------------------------------------------
    r = client.get("/files/content", headers=headers, params={"path": "proj1/raw.bin"})
    assert r.status_code == 415, r.status_code
    print("binary file -> 415 OK")

    # --- missing -> 404 ---------------------------------------------------------
    r = client.get("/files/content", headers=headers, params={"path": "proj1/nope.txt"})
    assert r.status_code == 404, r.status_code
    print("missing file -> 404 OK")

# Cleanup the fixture tree.
shutil.rmtree(user_root / "proj1", ignore_errors=True)

print("ALL USER-FILES CHECKS PASSED")
