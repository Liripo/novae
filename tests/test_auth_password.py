"""``POST /auth/password`` 修改当前用户密码测试。

覆盖：未登录 -> 401、旧密码错误 -> 400、新密码为空 -> 422、
修改成功后旧密码失效/新密码可登录、角色与创建时间保留。
"""


def test_change_password_requires_auth(client):
    r = client.post("/auth/password", json={"old_password": "a", "new_password": "b"})
    assert r.status_code == 401, r.status_code


def test_change_password_flow(app, client, admin_headers):
    # --- 旧密码错误 -> 400 --------------------------------------------------
    r = client.post(
        "/auth/password",
        headers=admin_headers,
        json={"old_password": "wrong", "new_password": "new-pw"},
    )
    assert r.status_code == 400, r.status_code

    # --- 新密码为空 -> 422 ----------------------------------------------------
    r = client.post(
        "/auth/password",
        headers=admin_headers,
        json={"old_password": "admin", "new_password": ""},
    )
    assert r.status_code == 422, r.status_code

    # --- 正确修改 -------------------------------------------------------------
    r = client.post(
        "/auth/password",
        headers=admin_headers,
        json={"old_password": "admin", "new_password": "new-pw"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"username": "admin", "changed": True}, r.json()

    # 旧密码失效、新密码可登录，角色保持 admin
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 401, r.status_code
    r = client.post("/auth/login", json={"username": "admin", "password": "new-pw"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin", r.json()


def test_change_password_preserves_created_at(app, client, admin_headers):
    import asyncio

    store = app.state.novae_user_store
    before = asyncio.run(store.get("admin"))["created_at"]
    r = client.post(
        "/auth/password",
        headers=admin_headers,
        json={"old_password": "admin", "new_password": "new-pw"},
    )
    assert r.status_code == 200, r.text
    after = asyncio.run(store.get("admin"))["created_at"]
    assert after == before, "重置密码不得覆盖创建时间"
