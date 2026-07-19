"""Web 搜索与网页抓取自定义工具（参考 hermes-agent 的 provider 设计）。

- ``websearch``：通用网页搜索。配置 ``TAVILY_API_KEY`` 时走 Tavily
  （结果质量更高），否则回退 DuckDuckGo（ddgs，无需密钥）。
- ``webfetch``：抓取网页正文（httpx + trafilatura 主内容抽取）。

两个工具以 agentscope ``FunctionTool`` 注册进 bio agent 的 Toolkit；
错误一律返回 ERROR chunk 与友好文案，不抛异常打断对话管线。
网络访问均为出站只读，不涉及本地状态修改。
"""

from __future__ import annotations

import asyncio
import os

import httpx
from agentscope.message import TextBlock, ToolResultState
from agentscope.tool import ToolChunk

_TIMEOUT = 20.0
_UA = {
    # 常见浏览器 UA，避免部分站点拒绝默认 httpx UA
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0 Safari/537.36 NovaeBot/0.9"
    )
}


def _chunk(text: str, state: ToolResultState = ToolResultState.SUCCESS) -> ToolChunk:
    return ToolChunk(content=[TextBlock(text=text)], state=state, is_last=True)


# --------------------------------------------------------------------------
# 搜索 provider（可拔插：Tavily -> DuckDuckGo）
# --------------------------------------------------------------------------


async def _search_tavily(query: str, max_results: int) -> list[tuple[str, str, str]] | None:
    """Tavily 搜索（REST 直连，免额外依赖）；未配置密钥返回 None。"""
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        return None
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(
            "https://api.tavily.com/search",
            json={"api_key": key, "query": query, "max_results": max_results},
        )
        r.raise_for_status()
        data = r.json()
    return [
        (item.get("title", ""), item.get("url", ""), item.get("content", ""))
        for item in data.get("results", [])
    ]


async def _search_ddgs(query: str, max_results: int) -> list[tuple[str, str, str]]:
    """DuckDuckGo 搜索（ddgs 包，无需密钥）。"""
    from ddgs import DDGS

    def _run() -> list[dict]:
        with DDGS() as d:
            return list(d.text(query, max_results=max_results))

    rows = await asyncio.to_thread(_run)
    return [(r.get("title", ""), r.get("href", ""), r.get("body", "")) for r in rows]


async def websearch(query: str, max_results: int = 8) -> ToolChunk:
    """Search the web for general information (news, docs, software, facts).

    Use this for non-academic queries. For papers and biomedical
    literature, prefer the paper-search / biomcp MCP tools when they are
    available. Returns a Markdown list of title / URL / snippet.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return (default 8).
    """
    try:
        results = await _search_tavily(query, max_results)
        provider = "Tavily"
        if results is None:
            results = await _search_ddgs(query, max_results)
            provider = "DuckDuckGo"
    except Exception as e:
        return _chunk(
            f"Web search failed ({type(e).__name__}): {e}",
            ToolResultState.ERROR,
        )
    if not results:
        return _chunk(f"No web results for: {query}")
    lines = [f"Web search results for {query!r} (provider: {provider}):\n"]
    for i, (title, url, snippet) in enumerate(results, 1):
        lines.append(f"{i}. [{title}]({url})\n   {snippet}")
    return _chunk("\n".join(lines))


# --------------------------------------------------------------------------
# 网页抓取
# --------------------------------------------------------------------------


async def _fetch_html(url: str) -> str:
    async with httpx.AsyncClient(
        timeout=_TIMEOUT, follow_redirects=True, headers=_UA
    ) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.text


def _extract_text(html: str) -> str | None:
    """trafilatura 主内容抽取（去导航/页脚/广告）。"""
    import trafilatura

    return trafilatura.extract(
        html,
        include_links=False,
        include_comments=False,
        include_tables=True,
        favor_recall=True,
    )


async def webfetch(url: str, max_chars: int = 20000) -> ToolChunk:
    """Fetch a web page and return its main text content.

    Use after websearch to read the full page behind a result link, or
    to read documentation pages directly. Long pages are truncated to
    ``max_chars`` characters.

    Args:
        url: The http(s) URL to fetch.
        max_chars: Truncate extracted text to this length (default 20000).
    """
    if not url.startswith(("http://", "https://")):
        return _chunk(
            f"Only http(s) URLs are supported: {url}",
            ToolResultState.ERROR,
        )
    try:
        html = await _fetch_html(url)
    except Exception as e:
        return _chunk(
            f"Failed to fetch {url} ({type(e).__name__}): {e}",
            ToolResultState.ERROR,
        )
    try:
        text = await asyncio.to_thread(_extract_text, html)
    except Exception as e:
        return _chunk(
            f"Failed to extract content from {url} ({type(e).__name__}): {e}",
            ToolResultState.ERROR,
        )
    if not text:
        return _chunk(
            f"Fetched {url} but could not extract readable main text "
            "(page may be JS-rendered or blocked)."
        )
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n\n... [truncated at {max_chars} chars]"
    return _chunk(f"Content of {url}:\n\n{text}")
