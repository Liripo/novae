"""集成测试：EnvModelConfigMiddleware 为缺少模型配置的会话/定时任务
注入 .env 配置的模型，且绝不覆盖显式配置；内置 agent 仅保留 bio。"""
import os

import novae.server as server_module

ENV_MODEL = os.environ["NOVAE_MODEL"]
EXPECTED_INJECTED = {
    "type": "openai_credential",
    "credential_id": server_module.ENV_CREDENTIAL_ID,
    "model": ENV_MODEL,
    "parameters": {},
}
AGENT_ID = "bio"


def _session_config(client, headers, session_id):
    r = client.get("/sessions/", headers=headers, params={"agent_id": AGENT_ID})
    assert r.status_code == 200, r.text
    return [s for s in r.json()["sessions"] if s["session"]["id"] == session_id][0][
        "session"
    ]["config"]


def test_builtin_agents_only_bio(client, admin_headers):
    r = client.get("/agent/", headers=admin_headers)
    assert r.status_code == 200, r.text
    agents = {a["id"]: a["data"]["name"] for a in r.json()["agents"]}
    for legacy in ("scrna", "rnaseq", "bioflow", "novae", "novae_optimizer", "flow"):
        assert legacy not in agents, agents
    assert agents == {"bio": "生信分析专家"}, agents


def test_session_without_config_gets_injected(client, admin_headers):
    r = client.post(
        "/sessions/",
        headers=admin_headers,
        json={"agent_id": AGENT_ID, "workspace_id": "w1", "name": "无配置会话"},
    )
    assert r.status_code == 201, r.text
    cfg = _session_config(client, admin_headers, r.json()["session_id"])
    assert cfg["chat_model_config"] == EXPECTED_INJECTED, cfg


def test_session_with_null_config_gets_injected(client, admin_headers):
    r = client.post(
        "/sessions/",
        headers=admin_headers,
        json={
            "agent_id": AGENT_ID,
            "workspace_id": "w2",
            "name": "null配置会话",
            "chat_model_config": None,
        },
    )
    assert r.status_code == 201, r.text
    cfg = _session_config(client, admin_headers, r.json()["session_id"])
    assert cfg["chat_model_config"] == EXPECTED_INJECTED, cfg


def test_explicit_session_config_preserved(client, admin_headers):
    explicit = {
        "type": "openai_credential",
        "credential_id": server_module.ENV_CREDENTIAL_ID,
        "model": "user-chosen-model",
        "parameters": {"temperature": 0.5},
    }
    r = client.post(
        "/sessions/",
        headers=admin_headers,
        json={
            "agent_id": AGENT_ID,
            "workspace_id": "w3",
            "name": "显式配置会话",
            "chat_model_config": explicit,
        },
    )
    assert r.status_code == 201, r.text
    cfg = _session_config(client, admin_headers, r.json()["session_id"])
    assert cfg["chat_model_config"] == explicit, cfg


def test_schedule_without_config_gets_injected(client, admin_headers):
    r = client.post(
        "/schedule/",
        headers=admin_headers,
        json={
            "name": "每日报告",
            "cron_expression": "17 9 * * *",
            "agent_id": AGENT_ID,
        },
    )
    assert r.status_code in (200, 201), r.text
    schedule_id = r.json().get("schedule_id")
    r = client.get("/schedule/", headers=admin_headers)
    assert r.status_code == 200, r.text
    sched = [s for s in r.json()["schedules"] if s["id"] == schedule_id][0]
    assert sched["data"]["chat_model_config"] == EXPECTED_INJECTED, sched["data"]
