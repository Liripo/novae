"""集成测试：ChatService._run_impl 包装器在运行失败时向会话事件流
发布 run_error 自定义事件——前端据此展示错误卡片并收尾「思考中」状态
（原实现只在后端记日志并吞掉异常，前端永远收不到终止信号）。"""
import asyncio

import pytest
from fastapi import HTTPException


def test_run_failure_publishes_run_error_event(app, client):
    # client 夹具触发 lifespan 启动，chat_service 才存在
    chat_service = app.state.chat_service
    # 会话不存在 -> _run_impl 抛 HTTPException(404)，包装器应发布 run_error
    with pytest.raises(HTTPException):
        asyncio.run(chat_service._run_impl("admin", "nosuchsession", "bio", None))

    bus = chat_service._message_bus
    key = bus._SESSION_EVENTS_KEY.format(sid="nosuchsession")
    entries = asyncio.run(bus.log_read(key))
    run_errors = [
        payload
        for _, payload in entries
        if payload.get("type") == "CUSTOM" and payload.get("name") == "run_error"
    ]
    assert len(run_errors) == 1, entries
    value = run_errors[0]["value"]
    assert value["error_type"] == "HTTPException", value
    assert "nosuchsession" in value["message"], value


def test_run_error_event_is_json_serializable(app, client):
    """事件负载必须可 JSON 序列化（SSE 流以 JSON 推送）。"""
    import json

    chat_service = app.state.chat_service
    with pytest.raises(HTTPException):
        asyncio.run(chat_service._run_impl("admin", "bad-session-2", "bio", None))
    bus = chat_service._message_bus
    key = bus._SESSION_EVENTS_KEY.format(sid="bad-session-2")
    entries = asyncio.run(bus.log_read(key))
    assert entries, "run_error 事件应已写入回放日志"
    json.dumps(entries[-1][1])  # 不抛异常即可
