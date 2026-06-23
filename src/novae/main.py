import asyncio

import typer
from loguru import logger
from typer import Typer, Argument, Option

from novae.agents import agents
from novae.console import print_response_stream
from agentscope.message import UserMsg
from agentscope.permission import PermissionMode


app = Typer(invoke_without_command=True, context_settings={"help_option_names": ["-h", "--help"]})


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context) -> None:
    """Novae 智能体 CLI。"""
    if ctx.invoked_subcommand is None:
        typer.echo(ctx.get_help())


@app.command()
def chat(
    message: str = Argument(..., help="发送的消息"),
    agent_id: str = Option("novae", help="智能体 ID"),
    stream: bool = Option(True, "--stream/--no-stream", help="是否流式输出"),
) -> None:
    """向指定智能体发送一条消息并打印回复。"""
    agent = next(a for a in agents if a.name == agent_id)
    if stream:
        asyncio.run(print_response_stream(agent, message))
    else:
        logger.info("非流式输出模式，设置权限自动确认，尽量少用。")
        agent.state.permission_context.mode = PermissionMode.BYPASS
        msg = asyncio.run(agent.reply(inputs=UserMsg(name="user", content=message)))
        print(msg)


if __name__ == "__main__":
    app()
