"""``NOVAE_MCP_SERVERS`` 环境变量解析测试（get_builtin_mcps）。

语义：未设置 → 内置默认（paper-search + biomcp）；
设置为 JSON 数组 → 完全替换默认（``[]`` 即全部禁用）。
覆盖：stdio/http 条目解析为 MCPClient、非法 JSON / 非数组 / 缺字段
条目的容错（记警告并跳过，绝不抛出阻断启动）。
"""

import json

from agentscope.mcp import MCPClient
from agentscope.mcp._config import HttpMCPConfig, StdioMCPConfig

from novae.config import get_builtin_mcps


def test_unset_env_returns_defaults(monkeypatch):
    """未配置时内置默认服务器（paper-search + biomcp）。"""
    monkeypatch.delenv("NOVAE_MCP_SERVERS", raising=False)
    mcps = get_builtin_mcps()
    assert [m.name for m in mcps] == ["paper-search", "biomcp"]

    paper, biomcp = mcps
    # 用 ``uv tool run`` 而非 uvx：uvx 是独立二进制，部分机器不存在
    assert paper.mcp_config.command == "uv"
    assert paper.mcp_config.args == ["tool", "run", "paper-search-mcp"]

    assert biomcp.mcp_config.command == "uv"
    assert biomcp.mcp_config.args == [
        "tool",
        "run",
        "--from",
        "biomcp-python",
        "biomcp",
        "run",
    ]


def test_empty_string_disables_all(monkeypatch):
    """显式设置为空串 → 禁用全部 MCP。"""
    monkeypatch.setenv("NOVAE_MCP_SERVERS", "")
    assert get_builtin_mcps() == []


def test_empty_array_disables_all(monkeypatch):
    """显式设置为 [] → 禁用全部 MCP。"""
    monkeypatch.setenv("NOVAE_MCP_SERVERS", "[]")
    assert get_builtin_mcps() == []


def test_parse_stdio_and_http_entries(monkeypatch):
    """command → StdioMCPConfig；url → HttpMCPConfig。"""
    monkeypatch.setenv(
        "NOVAE_MCP_SERVERS",
        json.dumps(
            [
                {
                    "name": "paper-search",
                    "command": "uvx",
                    "args": ["paper-search-mcp"],
                },
                {"name": "biomcp", "url": "http://localhost:3001/sse"},
            ]
        ),
    )
    mcps = get_builtin_mcps()
    assert len(mcps) == 2
    assert all(isinstance(m, MCPClient) for m in mcps)

    stdio, http = mcps
    assert stdio.name == "paper-search"
    assert isinstance(stdio.mcp_config, StdioMCPConfig)
    assert stdio.mcp_config.command == "uvx"
    assert stdio.mcp_config.args == ["paper-search-mcp"]

    assert http.name == "biomcp"
    assert isinstance(http.mcp_config, HttpMCPConfig)
    assert http.mcp_config.url == "http://localhost:3001/sse"


def test_stdio_entry_with_env_and_cwd(monkeypatch):
    """stdio 条目支持可选 env / cwd 字段。"""
    monkeypatch.setenv(
        "NOVAE_MCP_SERVERS",
        json.dumps(
            [
                {
                    "name": "fs",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem"],
                    "env": {"FOO": "bar"},
                    "cwd": "C:/data",
                }
            ]
        ),
    )
    (mcp,) = get_builtin_mcps()
    assert mcp.mcp_config.env == {"FOO": "bar"}
    assert mcp.mcp_config.cwd == "C:/data"


def test_invalid_json_returns_empty(monkeypatch):
    """非法 JSON → 记警告并返回空列表，不抛出。"""
    monkeypatch.setenv("NOVAE_MCP_SERVERS", "{not json")
    assert get_builtin_mcps() == []


def test_non_array_json_returns_empty(monkeypatch):
    """JSON 对象而非数组 → 返回空列表。"""
    monkeypatch.setenv("NOVAE_MCP_SERVERS", json.dumps({"name": "x"}))
    assert get_builtin_mcps() == []


def test_entries_missing_fields_are_skipped(monkeypatch):
    """缺 name 或 command/url 的条目被跳过，合法条目保留。"""
    monkeypatch.setenv(
        "NOVAE_MCP_SERVERS",
        json.dumps(
            [
                {"command": "uvx"},  # 缺 name
                {"name": "no-transport"},  # 缺 command/url
                "not-a-dict",  # 非对象
                {"name": "ok", "url": "http://localhost:3001/sse"},
            ]
        ),
    )
    mcps = get_builtin_mcps()
    assert len(mcps) == 1
    assert mcps[0].name == "ok"
