"""单元测试：Windows 下 uvicorn 的事件循环工厂补丁。

背景：`fastapi dev`（reload/worker 模式）会让 uvicorn 以 SelectorEventLoop
运行，导致 asyncio.create_subprocess_shell 抛出空消息的
NotImplementedError，Bash 工具全部失败且界面看不到错误原因。
novae.server 导入时必须把工厂替换为 ProactorEventLoop。
"""
import asyncio
import sys

import pytest

import novae.server  # noqa: F401  # 导入即应用补丁


@pytest.mark.skipif(sys.platform != "win32", reason="仅 Windows 需要该补丁")
def test_uvicorn_loop_factory_returns_proactor():
    from uvicorn.loops import asyncio as uvicorn_asyncio

    factory = uvicorn_asyncio.asyncio_loop_factory
    assert factory(use_subprocess=True) is asyncio.ProactorEventLoop
    assert factory(use_subprocess=False) is asyncio.ProactorEventLoop


@pytest.mark.skipif(sys.platform != "win32", reason="仅 Windows 需要验证")
def test_asyncio_subprocess_shell_works():
    """补丁生效后，asyncio 子进程（Bash 工具的执行通道）可用。"""
    import subprocess  # noqa: F401

    async def _run():
        proc = await asyncio.create_subprocess_shell(
            "echo novae-loop-ok",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        return proc.returncode, out.decode(errors="replace")

    rc, out = asyncio.run(_run())
    assert rc == 0
    assert "novae-loop-ok" in out
