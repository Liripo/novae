"""集成测试：仅 admin 可用的用户管理路由。

覆盖：无 token -> 401、非 admin -> 403、admin 创建用户（201）、
重复用户名 -> 409、非法用户名 -> 422、创建时即播种 env 凭证、
新用户可登录、admin 用户列表。
"""
import asyncio

import novae.server as server_module


def test_users_require_auth(client):
    r = client.get("/users/")
    assert r.status_code == 401, r.status_code
    r = client.post("/users/", json={"username": "x", "password": "y"})
    assert r.status_code == 401, r.status_code


def test_admin_user_management_flow(app, client, admin_headers):
    # --- admin 创建普通用户 ------------------------------------------------
    r = client.post(
        "/users/",
        headers=admin_headers,
        json={"username": "alice", "password": "alice-pw", "role": "user"},
    )
    assert r.status_code == 201, r.text
    assert r.json() == {"username": "alice", "role": "user"}, r.json()

    # --- 重复用户名 -> 409 --------------------------------------------------
    r = client.post(
        "/users/",
        headers=admin_headers,
        json={"username": "alice", "password": "whatever", "role": "user"},
    )
    assert r.status_code == 409, r.status_code

    # --- 非法用户名 -> 422 ---------------------------------------------------
    r = client.post(
        "/users/",
        headers=admin_headers,
        json={"username": "bad/name", "password": "x", "role": "user"},
    )
    assert r.status_code == 422, r.status_code

    # --- 创建时即播种 env 凭证（alice 首次登录前） ----------------------------
    cred = asyncio.run(
        app.state.storage.get_credential("alice", server_module.ENV_CREDENTIAL_ID)
    )
    assert cred is not None, "创建用户时必须播种 env 凭证"

    # --- 非 admin -> 403 -----------------------------------------------------
    r = client.post("/auth/login", json={"username": "alice", "password": "alice-pw"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "user", r.json()
    alice_headers = {"Authorization": f"Bearer {r.json()['token']}"}
    r = client.get("/users/", headers=alice_headers)
    assert r.status_code == 403, r.status_code
    r = client.post(
        "/users/",
        headers=alice_headers,
        json={"username": "mallory", "password": "x", "role": "admin"},
    )
    assert r.status_code == 403, r.status_code

    # --- 新用户登录后持有 env 凭证 --------------------------------------------
    r = client.get("/credential/", headers=alice_headers)
    assert r.status_code == 200, r.text
    env_creds = [
        c for c in r.json()["credentials"] if c["id"] == server_module.ENV_CREDENTIAL_ID
    ]
    assert len(env_creds) == 1, r.json()

    # --- admin 用户列表 -------------------------------------------------------
    r = client.get("/users/", headers=admin_headers)
    assert r.status_code == 200, r.text
    users = {u["username"]: u["role"] for u in r.json()["users"]}
    assert users.get("admin") == "admin" and users.get("alice") == "user", users
