"""用量统计聚合：从存储层统计当前用户的会话/消息/token 用量。

供 ``GET /usage/stats`` 使用。统计口径：
- 遍历用户的全部 agent → 会话 → 消息（分页拉取）；
- token 用量取 assistant 消息的 ``usage``（REPLY_END 时由框架盖章），
  无 usage 的历史消息不计入 token，但计入消息数与活跃天；
- 「最常用模型」按 token 占比（无 token 数据时退化为消息数占比）；
- 活跃热力图与按天趋势按本地日期（消息 created_at 的日期部分）聚合。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from agentscope.app.storage import StorageBase

# 单会话消息分页拉取页大小与上限（防失控）
_PAGE = 200
_MAX_MESSAGES_PER_SESSION = 5000


def _msg_date(created_at: str) -> date | None:
    """解析消息的 created_at（ISO 字符串）为日期，失败返回 None。"""
    try:
        return datetime.fromisoformat(created_at).date()
    except (ValueError, TypeError):
        return None


def _current_streak(active_dates: set[date], today: date) -> int:
    """当前连续活跃天数：从今天（或昨天）起向前连续有消息的天数。"""
    if today in active_dates:
        start = today
    elif today - timedelta(days=1) in active_dates:
        start = today - timedelta(days=1)
    else:
        return 0
    streak = 0
    cursor = start
    while cursor in active_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


async def compute_usage_stats(
    storage: StorageBase,
    user_id: str,
    days: int,
    today: date | None = None,
) -> dict[str, Any]:
    """聚合 user_id 最近 days 天的用量统计。"""
    today = today or date.today()
    start = today - timedelta(days=days - 1)

    total_tokens = 0
    total_messages = 0
    total_sessions = 0
    active_dates: set[date] = set()
    # date -> model -> tokens（按天按模型的 token 分布，供堆叠趋势图）
    daily_model_tokens: dict[date, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    # date -> messages（活跃热力图）
    daily_messages: dict[date, int] = defaultdict(int)
    # model -> tokens / messages（最常用模型）
    model_tokens: dict[str, int] = defaultdict(int)
    model_messages: dict[str, int] = defaultdict(int)

    agents = await storage.list_agents(user_id)
    for agent in agents:
        sessions = await storage.list_sessions(user_id, agent.id)
        for record in sessions:
            total_sessions += 1
            model = "unknown"
            chat_cfg = getattr(record.config, "chat_model_config", None)
            if chat_cfg is not None and getattr(chat_cfg, "model", None):
                model = chat_cfg.model

            # 游标分页：每页取最近的 _PAGE 条（时间正序），
            # 用本页最旧一条的 id 作为 before 继续向历史翻页
            before: str | None = None
            fetched = 0
            while fetched < _MAX_MESSAGES_PER_SESSION:
                batch, has_more = await storage.list_messages(
                    user_id, record.id, limit=_PAGE, before=before
                )
                if not batch:
                    break
                fetched += len(batch)
                oldest_in_page: date | None = None
                for msg in batch:
                    d = _msg_date(getattr(msg, "created_at", ""))
                    if d is None:
                        continue
                    if oldest_in_page is None or d < oldest_in_page:
                        oldest_in_page = d
                    if d < start or d > today:
                        continue
                    total_messages += 1
                    active_dates.add(d)
                    daily_messages[d] += 1
                    model_messages[model] += 1
                    usage = getattr(msg, "usage", None)
                    if usage is not None:
                        tokens = usage.input_tokens + usage.output_tokens
                        total_tokens += tokens
                        daily_model_tokens[d][model] += tokens
                        model_tokens[model] += tokens
                # 本页最旧消息已早于统计窗口，更早的页不必再拉
                if oldest_in_page is not None and oldest_in_page < start:
                    break
                if not has_more:
                    break
                before = getattr(batch[0], "id", None)
                if before is None:
                    break

    # 最常用模型：优先 token 占比，无 token 数据时按消息数
    top_model = None
    if model_tokens and sum(model_tokens.values()) > 0:
        name = max(model_tokens, key=model_tokens.get)
        top_model = {
            "name": name,
            "share": model_tokens[name] / sum(model_tokens.values()),
        }
    elif model_messages:
        name = max(model_messages, key=model_messages.get)
        top_model = {
            "name": name,
            "share": model_messages[name] / sum(model_messages.values()),
        }

    # 连续的按天序列（前端热力图/趋势图直接遍历）
    daily = []
    cursor = start
    while cursor <= today:
        daily.append(
            {
                "date": cursor.isoformat(),
                "messages": daily_messages.get(cursor, 0),
                "tokens": sum(daily_model_tokens.get(cursor, {}).values()),
                "models": dict(daily_model_tokens.get(cursor, {})),
            }
        )
        cursor += timedelta(days=1)

    return {
        "days": days,
        "total_tokens": total_tokens,
        "total_sessions": total_sessions,
        "total_messages": total_messages,
        "active_days": len(active_dates),
        "streak_days": _current_streak(active_dates, today),
        "top_model": top_model,
        "daily": daily,
    }
