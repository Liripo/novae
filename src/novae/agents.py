"""The single built-in agent definition and seeding logic."""
from fastapi import FastAPI

from agentscope.agent import ContextConfig, ReActConfig
from agentscope.app.storage import AgentData, AgentRecord, StorageBase

BUILTIN_AGENT_ID = "novae-builtin"
BUILTIN_AGENT_NAME = "Novae"
BUILTIN_AGENT_SYSTEM_PROMPT = (
    "You are Novae, a coding assistant. Use the built-in tools "
    "(Bash, Read, Write, Edit, Glob, Grep) to help the user with "
    "software engineering tasks in the workspace."
)

# The user the built-in agent belongs to. For now every seeded user gets
# the same built-in agent; extend here when multi-user scoping is needed.
BUILTIN_AGENT_USER = "liripo"


async def seed_builtin_agent(app: FastAPI) -> None:
    """Ensure the single built-in agent exists for the default user."""
    storage: StorageBase = app.state.storage
    agents = await storage.list_agents(BUILTIN_AGENT_USER)
    if any(a.id == BUILTIN_AGENT_ID for a in agents):
        return
    record = AgentRecord(
        id=BUILTIN_AGENT_ID,
        user_id=BUILTIN_AGENT_USER,
        source="user",
        data=AgentData(
            id=BUILTIN_AGENT_ID,
            name=BUILTIN_AGENT_NAME,
            system_prompt=BUILTIN_AGENT_SYSTEM_PROMPT,
            context_config=ContextConfig(),
            react_config=ReActConfig(),
        ),
    )
    await storage.upsert_agent(BUILTIN_AGENT_USER, record)
