"""集成测试：.env 管理的凭证在启动/登录时播种（幂等、固定 id）。"""
import os

import novae.server as server_module


def test_env_credential_seeded_on_login(client, admin_headers):
    r = client.get("/credential/", headers=admin_headers)
    assert r.status_code == 200, r.text
    creds = r.json()["credentials"]
    env_creds = [c for c in creds if c["id"] == server_module.ENV_CREDENTIAL_ID]
    assert len(env_creds) == 1, f"应恰好有一条 env 凭证，实际 {creds}"
    data = env_creds[0]["data"]
    assert data["type"] == "openai_credential", data
    assert data["name"] == "系统默认", data
    assert data.get("base_url") == os.environ["OPENAI_BASE_URL"], data


def test_relogin_does_not_duplicate_credential(client, admin_headers):
    # 再次登录 -> 仍然只有一条记录（原地 upsert）
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    r = client.get("/credential/", headers=admin_headers)
    creds = [
        c for c in r.json()["credentials"] if c["id"] == server_module.ENV_CREDENTIAL_ID
    ]
    assert len(creds) == 1, "重复登录不应产生重复凭证"


def test_model_route_responds(client, admin_headers):
    # 模型列表路由存在（无真实 key 时上游可能失败，只要不是 404）
    r = client.get(
        "/model/", headers=admin_headers, params={"credential_type": "openai_credential"}
    )
    assert r.status_code != 404
