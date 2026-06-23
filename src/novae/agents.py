from pathlib import Path

from fastapi import FastAPI
from agentscope.agent import Agent, ContextConfig, ReActConfig
from agentscope.app.storage import AgentData, AgentRecord, StorageBase
from agentscope.skill import LocalSkillLoader

from agentscope.tool import Toolkit, Bash, Edit, Glob, Grep, Read, Write
from novae.config import get_model

SKILLS_DIR = Path.home() / ".agents" / "skills"
_skills_loader = LocalSkillLoader(str(SKILLS_DIR), scan_subdir=True)

CODING_TOOLS = [
    Bash(),
    Edit(),
    Glob(),
    Grep(),
    Read(),
    Write(),
]


novae_agent = Agent(
    name="novae",
    system_prompt=(
        "你是 Novae，一名科学研究专家。"
    ),
    model = get_model(),
    toolkit=Toolkit(
        tools=CODING_TOOLS,
        skills_or_loaders=[_skills_loader],
    ),
)

optimizer_agent = Agent(
    name="novae_optimizer",
    system_prompt=(
        "你是 Novae Optimizer，一名代码性能优化专家。"
        "分析工作区内的代码，识别性能瓶颈并提出优化方案。"
    ),
    model = get_model(),
    toolkit=Toolkit(
        tools=CODING_TOOLS,
        skills_or_loaders=[_skills_loader],
    ),
)




agents = [novae_agent, optimizer_agent]


async def _get_user_ids(app: FastAPI) -> list[str]:
    user_store = getattr(app.state, "novae_user_store", None)
    if user_store is not None:
        return await user_store.list_usernames()
    else:
        return []


async def seed_builtin_agent(app: FastAPI) -> None:
    """为所有已注册用户写入内置 agent 记录。"""
    storage: StorageBase = app.state.storage
    user_ids = await _get_user_ids(app)

    for agent in agents:
        for user_id in user_ids:
            record = AgentRecord(
                id=agent.name,
                user_id=user_id,
                source="user",
                data=AgentData(
                    id=agent.name,
                    name=agent.name,
                    system_prompt=agent._system_prompt,
                    context_config=ContextConfig(),
                    react_config=ReActConfig(),
                ),
            )
            await storage.upsert_agent(user_id, record)
