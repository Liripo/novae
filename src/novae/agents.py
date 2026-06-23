import asyncio
import os

from fastapi import FastAPI
from typer import Typer, Argument

from agentscope.agent import Agent, ContextConfig, ReActConfig
from agentscope.app.storage import AgentData, AgentRecord, StorageBase
from agentscope.credential import OpenAICredential
from agentscope.model import OpenAIChatModel
from agentscope.state import AgentState
from agentscope.tool import Toolkit, Bash, Edit, Glob, Grep, Read, Write



BUILTIN_AGENTS = [
    {
        "id": "novae-coder",
        "name": "Novae Coder",
        "system_prompt": (
            "你是 Novae Coder，一名专业的编码助手。"
            "你可以使用 Bash、Read、Write、Edit、Glob、Grep 等工具"
            "协助用户完成工作区内的软件工程任务。"
            "请遵循用户的编码规范，优先使用已有工具库，保持代码简洁可读。"
        ),
    },
    {
        "id": "novae-optimizer",
        "name": "Novae Optimizer",
        "system_prompt": (
            "你是 Novae Optimizer，一名代码性能优化专家。"
            "分析工作区内的代码，识别性能瓶颈并提出优化方案。"
            "你可以使用 Bash 运行性能测试，用 Read/Glob/Grep 定位热点代码路径，"
            "用 Edit/Write 直接修改代码来提升性能。"
            "关注算法复杂度、I/O 模式、内存使用和并发效率。"
        ),
    },
]


async def seed_builtin_agent(app: FastAPI) -> None:
    """为所有已注册用户写入内置 agent 记录。"""
    storage: StorageBase = app.state.storage
    user_store = getattr(app.state, "novae_user_store", None)

    if user_store is not None:
        user_ids = await user_store.list_usernames()
    else:
        user_ids = ["liripo"]

    for spec in BUILTIN_AGENTS:
        for user_id in user_ids:
            record = AgentRecord(
                id=spec["id"],
                user_id=user_id,
                source="user",
                data=AgentData(
                    id=spec["id"],
                    name=spec["name"],
                    system_prompt=spec["system_prompt"],
                    context_config=ContextConfig(),
                    react_config=ReActConfig(),
                ),
            )
            await storage.upsert_agent(user_id, record)


def _build_default_toolkit() -> Toolkit:
    return Toolkit(
        tools=[
            Bash(),
            Edit(),
            Glob(),
            Grep(),
            Read(),
            Write(),
        ],
    )


def get_agent(agent_id: str) -> Agent:
    """根据智能体 ID 构建一个完整配置的 Agent 实例。"""
    spec = next(a for a in BUILTIN_AGENTS if a["id"] == agent_id)

    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model_name = os.getenv("NOVAE_MODEL", "")

    model = OpenAIChatModel(
        model=model_name,
        credential=OpenAICredential(api_key=api_key, base_url=base_url),
    )

    return Agent(
        name=spec["name"],
        system_prompt=spec["system_prompt"],
        model=model,
        toolkit=_build_default_toolkit(),
        state=AgentState(),
    )


app = Typer()


@app.command()
def chat(
    agent_id: str = Argument(..., help="智能体 ID"),
    message: str = Argument(..., help="发送的消息"),
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> None:
    """向指定智能体发送一条消息并打印回复。"""
    if api_key is not None:
        os.environ["OPENAI_API_KEY"] = api_key
    if base_url is not None:
        os.environ["OPENAI_BASE_URL"] = base_url
    if model is not None:
        os.environ["NOVAE_MODEL"] = model

    from agentscope.message import UserMsg

    agent = get_agent(agent_id)

    async def _run() -> None:
        msg = UserMsg(name="user", content=message)
        reply = await agent.reply(inputs=msg)
        text = reply.get_text_content()
        print(text)

    asyncio.run(_run())


if __name__ == "__main__":
    app()
