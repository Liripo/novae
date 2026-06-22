from agno.agent import Agent
from agno.models.openai import OpenAILike
from agno.tools.coding import CodingTools

from novae.config import get_config

cfg = get_config()

coding_tools = CodingTools(base_dir="./data",restrict_to_base_dir = False,all = True,allowed_commands = None)
coding_tools.allowed_commands += ["Get-Location","&&","pwd"]

novae_agent = Agent(
    model=OpenAILike(id=cfg.model_id, api_key=cfg.api_key, base_url=cfg.base_url),
    tools=[coding_tools],
    instructions="You are a coding assistant. Use the coding tools to help the user.",
    markdown=True,
    stream=True,
    add_history_to_context = True
)
