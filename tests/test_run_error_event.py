"""集成测试：ChatService._run_impl 包装器在运行失败时向会话事件流
**实时发布** run_error 自定义事件——前端据此展示错误卡片并收尾
「思考中」状态（原实现只在后端记日志并吞掉异常，前端永远收不到
终止信号）。

run_error 刻意不写入会话重放日志：错误是瞬时通知，重开会话不应
再次弹出错误卡片（若失败发生在 session_run 锁之外，重放日志不会
被 log_trim 清理，事件永久残留会导致每次打开会话重复显示）。
"""
import asyncio
import json

import pytest
from fastapi import HTTPException


def _capture_publish(bus):
    """包装 bus.publish，记录实时发布的负载，返回 (calls, restore)。"""
    original = bus.publish
    calls: list[tuple[str, dict]] = []

    async def spy(channel, payload):
        calls.append((channel, payload))
        await original(channel, payload)

    bus.publish = spy
    return calls, original


def test_run_failure_publishes_run_error_event_live_only(app, client):
    # client 夹具触发 lifespan 启动，chat_service 才存在
    chat_service = app.state.chat_service
    bus = chat_service._message_bus
    calls, original = _capture_publish(bus)
    try:
        # 会话不存在 -> _run_impl 抛 HTTPException(404)，包装器应发布 run_error
        with pytest.raises(HTTPException):
            asyncio.run(chat_service._run_impl("admin", "nosuchsession", "bio", None))
    finally:
        bus.publish = original

    key = bus._SESSION_EVENTS_KEY.format(sid="nosuchsession")
    run_errors = [
        payload
        for channel, payload in calls
        if channel == key
        and payload.get("type") == "CUSTOM"
        and payload.get("name") == "run_error"
    ]
    assert len(run_errors) == 1, calls
    value = run_errors[0]["value"]
    assert value["error_type"] == "HTTPException", value
    assert "nosuchsession" in value["message"], value
    # 实时帧必须带 _live 标记，前端据此区分重放的历史帧
    assert run_errors[0]["_live"] is True, run_errors[0]

    # 关键回归断言：run_error 不得写入重放日志，否则每次打开会话
    # SSE 重放都会再次弹出错误卡片
    entries = asyncio.run(bus.log_read(key))
    assert entries == [], entries


def test_run_error_event_is_json_serializable(app, client):
    """事件负载必须可 JSON 序列化（SSE 流以 JSON 推送）。"""
    chat_service = app.state.chat_service
    bus = chat_service._message_bus
    calls, original = _capture_publish(bus)
    try:
        with pytest.raises(HTTPException):
            asyncio.run(chat_service._run_impl("admin", "bad-session-2", "bio", None))
    finally:
        bus.publish = original

    assert calls, "run_error 事件应已实时发布"
    json.dumps(calls[-1][1])  # 不抛异常即可
