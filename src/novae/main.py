import asyncio

import typer
from loguru import logger
from typer import Typer, Argument, Option

from novae.agents import create_bio_agent
from novae.config import get_builtin_mcps
from novae.console import print_response_stream
from agentscope.message import UserMsg
from agentscope.permission import PermissionMode


app = Typer(invoke_without_command=True, context_settings={"help_option_names": ["-h", "--help"]})


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context) -> None:
    """Novae 智能体 CLI。"""
    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())


async def _chat(message: str, stream: bool) -> None:
    """连接内置 MCP（paper-search / biomcp）后创建 agent 并执行对话。

    CLI 没有项目工作区概念，MCP 直接挂到 agent 的 Toolkit；连接失败
    的 MCP 记警告后跳过（与服务端工作区初始化的容错策略一致）。
    """
    mcps = []
    for m in get_builtin_mcps():
        try:
            await m.connect()
            mcps.append(m)
            logger.info("MCP 已连接：{}", m.name)
        except Exception as e:
            logger.warning("MCP {} 连接失败，本次对话不可用：{}", m.name, e)
    agent = create_bio_agent(mcps=mcps)
    try:
        if stream:
            await print_response_stream(agent, message)
        else:
            logger.info("非流式输出模式，设置权限自动确认，尽量少用。")
            agent.state.permission_context.mode = PermissionMode.BYPASS
            msg = await agent.reply(inputs=UserMsg(name="user", content=message))
            print(msg)
    finally:
        for m in mcps:
            try:
                await m.close()
            except BaseException:
                # anyio 任务域差异会让 close 抛出 CancelledError
                # （BaseException，普通 except 接不住）；子进程已被
                # 终止，退出阶段的报错直接吞掉，不影响对话结果。
                pass


@app.command()
def chat(
    message: str = Argument(..., help="发送的消息"),
    agent_id: str = Option("bio", help="智能体 ID"),
    stream: bool = Option(True, "--stream/--no-stream", help="是否流式输出"),
) -> None:
    """向指定智能体发送一条消息并打印回复。"""
    if agent_id != "bio":
        raise typer.BadParameter(f"未知智能体：{agent_id}（目前仅内置 bio）")
    asyncio.run(_chat(message, stream))


if __name__ == "__main__":
    app()
