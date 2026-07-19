"""``GET /meta`` 与 ``GET /usage/stats`` 测试。

覆盖：版本号来自包元数据/pyproject、用量统计的空态形状、
days 参数、以及有会话+消息数据时的计数与模型占比。
"""
import asyncio
import re
from datetime import datetime
from pathlib import Path

from agentscope.message import Msg, TextBlock

import novae.server as server_module


def test_meta_returns_pyproject_version(client):
    r = client.get("/meta")
    assert r.status_code == 200, r.text
    pyproject = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(
        encoding="utf-8"
    )
    expected = re.search(r'^version\s*=\s*"([^"]+)"', pyproject, re.MULTILINE).group(1)
    assert r.json()["version"] == expected


def test_usage_stats_requires_auth(client):
    assert client.get("/usage/stats").status_code in (401, 403)


def test_usage_stats_empty(client, admin_headers):
    r = client.get("/usage/stats?days=7", headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["days"] == 7
    assert data["total_tokens"] == 0
    assert data["total_messages"] == 0
    assert data["active_days"] == 0
    assert data["streak_days"] == 0
    assert data["top_model"] is None
    # 按天序列长度 == days（前端热力图/趋势图直接遍历）
    assert len(data["daily"]) == 7
    assert all(d["messages"] == 0 and d["tokens"] == 0 for d in data["daily"])


def test_usage_stats_counts_messages(app, client, admin_headers):
    """造一个会话 + 两条带 token 用量的消息，验证计数与模型占比。"""
    # 通过真实 API 建会话（bio 为内置 agent，登录时已播种）
    r = client.post(
        "/sessions/",
        headers=admin_headers,
        json={
            "agent_id": "bio",
            "workspace_id": "w1",
            "chat_model_config": {
                "type": "openai_credential",
                "credential_id": server_module.ENV_CREDENTIAL_ID,
                "model": "test-model-a",
                "parameters": {},
            },
        },
    )
    assert r.status_code in (200, 201), r.text
    session_id = r.json()["session_id"]

    storage = app.state.storage
    now = datetime.now().isoformat()

    async def _seed():
        await storage.upsert_message(
            "admin",
            session_id,
            Msg(role="user", name="user", content=[TextBlock(text="hi")], created_at=now),
        )
        await storage.upsert_message(
            "admin",
            session_id,
            Msg(
                role="assistant",
                name="bio",
                content=[TextBlock(text="hello")],
                created_at=now,
                finished_at=now,
                usage={"input_tokens": 60, "output_tokens": 40},
            ),
        )

    asyncio.run(_seed())

    r = client.get("/usage/stats?days=30", headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total_messages"] == 2
    assert data["total_tokens"] == 100
    assert data["total_sessions"] >= 1
    assert data["active_days"] == 1
    assert data["streak_days"] == 1
    assert data["top_model"]["name"] == "test-model-a"
    assert data["top_model"]["share"] == 1.0
    today_entry = data["daily"][-1]
    assert today_entry["messages"] == 2
    assert today_entry["models"] == {"test-model-a": 100}
