"""集成测试：运行环境中间件（extra_agent_middlewares）解析会话项目
工作目录，并在系统提示词注入「## 运行环境」段落（OS 信息 + 绝对路径）。
未知会话/不安全路径不产生中间件。"""
import asyncio
import platform
from pathlib import Path

import novae.server as server_module


def test_runtime_env_middleware(app, client, admin_headers):
    # 创建绑定项目 w1 的会话
    r = client.post(
        "/sessions/",
        headers=admin_headers,
        json={"agent_id": "bio", "workspace_id": "w1", "name": "运行环境测试会话"},
    )
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]

    factory = app.state.extra_agent_middlewares
    assert factory is not None, "extra_agent_middlewares 未注册"

    # 已知会话 -> 恰好一个携带工作目录的中间件
    mws = asyncio.run(factory("admin", "bio", sid))
    assert len(mws) == 1, mws
    expected_workdir = str(Path(server_module.cfg.workspace_root).resolve() / "admin" / "w1")

    prompt = asyncio.run(mws[0].on_system_prompt(None, "BASE_PROMPT"))
    assert prompt.startswith("BASE_PROMPT"), prompt
    assert "## 运行环境" in prompt, prompt
    assert "操作系统" in prompt, prompt
    assert platform.system() in prompt or (
        platform.system() == "Darwin" and "macOS" in prompt
    ), prompt
    assert expected_workdir in prompt, (expected_workdir, prompt)
    if platform.system() == "Windows":
        assert "Git Bash" in prompt and "C:\\" in prompt, prompt


def test_unknown_session_yields_no_middleware(app, client, admin_headers):
    factory = app.state.extra_agent_middlewares
    # 未知会话 -> 无中间件（不抛异常）
    assert asyncio.run(factory("admin", "bio", "nosuchsession")) == []


def test_unsafe_user_id_yields_no_middleware(app, client, admin_headers):
    r = client.post(
        "/sessions/",
        headers=admin_headers,
        json={"agent_id": "bio", "workspace_id": "w1", "name": "运行环境测试会话"},
    )
    assert r.status_code == 201, r.text
    sid = r.json()["session_id"]
    factory = app.state.extra_agent_middlewares
    # 不安全的路径组件 -> 无中间件
    assert asyncio.run(factory("ad/min", "bio", sid)) == []
