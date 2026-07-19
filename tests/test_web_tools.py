"""websearch / webfetch 自定义工具与 bio agent 工厂测试。

网络层全部打桩：只验证 provider 选择、输出格式、错误路径与截断。
"""
import asyncio

from agentscope.message import ToolResultState

import novae.web_tools as wt
from novae.agents import create_bio_agent


def _text(chunk):
    return chunk.content[0].text


# ---------- websearch -------------------------------------------------------


def test_websearch_ddgs_default_provider(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    async def fake_ddgs(query, max_results):
        return [
            ("Title A", "https://a.example", "snippet a"),
            ("Title B", "https://b.example", "snippet b"),
        ]

    monkeypatch.setattr(wt, "_search_ddgs", fake_ddgs)
    chunk = asyncio.run(wt.websearch("tp53 lung cancer"))
    assert chunk.state == ToolResultState.SUCCESS
    text = _text(chunk)
    assert "DuckDuckGo" in text
    assert "[Title A](https://a.example)" in text
    assert "tp53 lung cancer" in text


def test_websearch_tavily_when_key_present(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "test-key")

    async def fake_tavily(query, max_results):
        return [("T", "https://t.example", "s")]

    monkeypatch.setattr(wt, "_search_tavily", fake_tavily)
    chunk = asyncio.run(wt.websearch("hello"))
    assert chunk.state == ToolResultState.SUCCESS
    assert "Tavily" in _text(chunk)


def test_websearch_error_path(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    async def boom(query, max_results):
        raise RuntimeError("network down")

    monkeypatch.setattr(wt, "_search_ddgs", boom)
    chunk = asyncio.run(wt.websearch("x"))
    assert chunk.state == ToolResultState.ERROR
    assert "Web search failed" in _text(chunk)
    assert "network down" in _text(chunk)


def test_websearch_empty_results(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    async def empty(query, max_results):
        return []

    monkeypatch.setattr(wt, "_search_ddgs", empty)
    chunk = asyncio.run(wt.websearch("nothing-here"))
    assert chunk.state == ToolResultState.SUCCESS
    assert "No web results" in _text(chunk)


# ---------- webfetch --------------------------------------------------------


def test_webfetch_rejects_non_http():
    chunk = asyncio.run(wt.webfetch("ftp://example.com/x"))
    assert chunk.state == ToolResultState.ERROR
    assert "http" in _text(chunk)


def test_webfetch_success_and_truncation(monkeypatch):
    async def fake_fetch(url):
        return "<html><body>long page</body></html>"

    monkeypatch.setattr(wt, "_fetch_html", fake_fetch)
    monkeypatch.setattr(wt, "_extract_text", lambda html: "A" * 100)
    chunk = asyncio.run(wt.webfetch("https://a.example", max_chars=40))
    assert chunk.state == ToolResultState.SUCCESS
    text = _text(chunk)
    assert "A" * 40 in text
    assert "truncated at 40 chars" in text


def test_webfetch_fetch_error(monkeypatch):
    async def boom(url):
        raise RuntimeError("timeout")

    monkeypatch.setattr(wt, "_fetch_html", boom)
    chunk = asyncio.run(wt.webfetch("https://a.example"))
    assert chunk.state == ToolResultState.ERROR
    assert "Failed to fetch" in _text(chunk)


def test_webfetch_unextractable(monkeypatch):
    async def fake_fetch(url):
        return "<html></html>"

    monkeypatch.setattr(wt, "_fetch_html", fake_fetch)
    monkeypatch.setattr(wt, "_extract_text", lambda html: None)
    chunk = asyncio.run(wt.webfetch("https://a.example"))
    assert chunk.state == ToolResultState.SUCCESS
    assert "could not extract readable main text" in _text(chunk)


# ---------- agent 工厂 -------------------------------------------------------


def test_create_bio_agent_registers_web_tools():
    agent = create_bio_agent()

    async def _check():
        assert await agent.toolkit.get_tool("websearch") is not None
        assert await agent.toolkit.get_tool("webfetch") is not None

    asyncio.run(_check())
    # prompt 分节结构与 web 工具条款
    prompt = agent._system_prompt
    assert "## 核心原则" in prompt and "## 生信领域红线" in prompt
    assert "websearch" in prompt and "webfetch" in prompt
