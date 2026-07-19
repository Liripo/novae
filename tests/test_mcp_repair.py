"""存量工作区 .mcp 一次性修复迁移测试（repair_workspace_mcps）。

场景：默认 MCP 曾以 uvx 启动，在缺 uvx 的机器上被静默移除并持久化为
空 .mcp。修复函数应在首次运行时把缺失的默认 MCP 按名称补回，且只
运行一次（marker 为记），不复活用户之后主动删除的条目。
"""
import json

from novae.workspace import repair_workspace_mcps


def _write_mcp(root, user, ws, entries):
    d = root / user / ws
    d.mkdir(parents=True, exist_ok=True)
    (d / ".mcp").write_text(json.dumps(entries), encoding="utf-8")
    return d / ".mcp"


def _names(mcp_file):
    return [e["name"] for e in json.loads(mcp_file.read_text(encoding="utf-8"))]


def test_repair_adds_missing_defaults_once(tmp_path, monkeypatch):
    # 用一个确定的自定义默认列表，避免依赖真实 DEFAULT_MCP_SERVERS
    monkeypatch.setenv(
        "NOVAE_MCP_SERVERS",
        json.dumps([{"name": "fix-mcp", "command": "uv", "args": ["tool", "run", "x"]}]),
    )
    empty = _write_mcp(tmp_path, "admin", "ws1", [])
    existing = _write_mcp(
        tmp_path,
        "admin",
        "ws2",
        [{"name": "fix-mcp", "is_stateful": True, "mcp_config": {"type": "stdio_mcp", "command": "uv"}}],
    )

    repaired = repair_workspace_mcps(tmp_path)
    assert repaired == 1, "只有缺条目的 ws1 需要补写"
    assert _names(empty) == ["fix-mcp"]
    assert _names(existing) == ["fix-mcp"], "已有同名条目不得重复添加"
    # 补写的内容可通过 MCPClient 校验（与 agentscope 加载逻辑一致）
    from agentscope.mcp import MCPClient

    entry = json.loads(empty.read_text(encoding="utf-8"))[0]
    assert MCPClient.model_validate(entry).name == "fix-mcp"
    assert (tmp_path / ".mcp_repair_v1").exists()


def test_repair_never_resurrects_user_deletions(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "NOVAE_MCP_SERVERS",
        json.dumps([{"name": "fix-mcp", "command": "uv", "args": ["tool", "run", "x"]}]),
    )
    mcp_file = _write_mcp(tmp_path, "admin", "ws1", [])

    # 第一次运行：补回并写 marker
    assert repair_workspace_mcps(tmp_path) == 1
    assert _names(mcp_file) == ["fix-mcp"]

    # 用户随后删除该 MCP；再次运行（如重启服务）不得复活
    mcp_file.write_text("[]", encoding="utf-8")
    assert repair_workspace_mcps(tmp_path) == 0
    assert _names(mcp_file) == []


def test_repair_tolerates_broken_files(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "NOVAE_MCP_SERVERS",
        json.dumps([{"name": "fix-mcp", "command": "uv", "args": ["tool", "run", "x"]}]),
    )
    d = tmp_path / "admin" / "ws1"
    d.mkdir(parents=True)
    (d / ".mcp").write_text("not-json", encoding="utf-8")

    # 坏文件不阻断，marker 仍写入
    assert repair_workspace_mcps(tmp_path) == 0
    assert (tmp_path / ".mcp_repair_v1").exists()
