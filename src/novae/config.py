import json
import os
from dataclasses import dataclass
from pathlib import Path

from agentscope.credential import OpenAICredential
from agentscope.mcp import MCPClient
from agentscope.mcp._config import HttpMCPConfig, StdioMCPConfig
from agentscope.model import OpenAIChatModel
from dotenv import load_dotenv
from loguru import logger
from pydantic import SecretStr

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


@dataclass(frozen=True)
class Config:
    redis_host: str
    redis_port: int
    redis_db: int
    redis_password: str | None
    workspace_root: Path
    jwt_secret: str
    jwt_expire_hours: int


def get_config() -> Config:
    redis_host = os.getenv("NOVAE_REDIS_HOST", "localhost")
    redis_port = int(os.getenv("NOVAE_REDIS_PORT", "6379"))
    redis_db = int(os.getenv("NOVAE_REDIS_DB", "0"))
    redis_password = os.getenv("NOVAE_REDIS_PASSWORD") or None

    workspace_root = Path(
        os.getenv(
            "NOVAE_WORKSPACE_ROOT",
            str(Path.home() / ".novae" / "workspaces"),
        )
    )
    workspace_root.mkdir(parents=True, exist_ok=True)

    jwt_secret = os.getenv(
        "NOVAE_JWT_SECRET",
        "novae-dev-jwt-secret-change-me-in-production",
    )
    jwt_expire_hours = int(os.getenv("NOVAE_JWT_EXPIRE_HOURS", "168"))

    return Config(
        redis_host=redis_host,
        redis_port=redis_port,
        redis_db=redis_db,
        redis_password=redis_password,
        workspace_root=workspace_root,
        jwt_secret=jwt_secret,
        jwt_expire_hours=jwt_expire_hours,
    )


def get_model() -> OpenAIChatModel:
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    model_name = os.getenv("NOVAE_MODEL")
    if not api_key or not model_name or not base_url:
        raise ValueError("Missing required environment variables: OPENAI_API_KEY, OPENAI_BASE_URL, NOVAE_MODEL")

    return OpenAIChatModel(
        model=model_name,
        credential=OpenAICredential(
            api_key=SecretStr(api_key), base_url=base_url
        ),
    )


def get_builtin_skill_paths() -> list[str]:
    """枚举要播种到每个项目工作区的技能目录（每个目录含一个 SKILL.md）。

    - 仓库内置 ``skills/`` 目录：按类别分子目录（office/ research/
      scientific/），递归查找所有 SKILL.md；
    - 用户级 ``~/.agents/skills/`` 目录：用户自建的个性化技能。

    工作区初始化时会把这些目录**复制**进 ``<workdir>/skills/``，
    ChatService 组装 agent 时从工作区读取技能列表——这是会话中
    技能真正生效的入口（直接挂在 agent 实例上的 loader 不会进入
    运行时的工具包）。
    """
    paths: list[str] = []
    for root in (ROOT_DIR / "skills", Path.home() / ".agents" / "skills"):
        if not root.is_dir():
            continue
        paths.extend(
            str(p.parent) for p in sorted(root.rglob("SKILL.md"))
        )
    return paths


# 内置 MCP 服务器。Zotero / GitHub 等外部服务器通过 NOVAE_MCP_SERVERS
# 按需添加。
# 注意：启动命令用 ``uv tool run`` 而不是 ``uvx``——uvx 是独立分发的
# 二进制，部分机器（如仅装 uv 的环境）没有 uvx，会导致 MCP 连接失败
# 并被工作区初始化静默移除；uv 一定存在（本项目即经 uv 运行）。
DEFAULT_MCP_SERVERS: list[dict] = [
    {
        "name": "paper-search",
        "command": "uv",
        "args": ["tool", "run", "paper-search-mcp"],
    },
    {
        "name": "biomcp",
        "command": "uv",
        "args": ["tool", "run", "--from", "biomcp-python", "biomcp", "run"],
    },
]


def get_builtin_mcps() -> list[MCPClient]:
    """解析内置 MCP 服务器列表，播种到每个新项目工作区。

    - ``NOVAE_MCP_SERVERS`` 未设置：使用 ``DEFAULT_MCP_SERVERS``；
    - 设置为 JSON 数组：以该配置完全替换默认列表（``[]`` 即全部禁用）。

    数组元素为对象，两种传输：
    - stdio：``{"name": "paper-search", "command": "uv",
      "args": ["tool", "run", "paper-search-mcp"], "env": {...}}``
    - HTTP：``{"name": "biomcp", "url": "http://localhost:3001/sse",
      "headers": {...}}``

    解析失败（JSON 非法、条目缺字段、name 含非法字符）时跳过该条目并
    记警告——MCP 属于增强能力，绝不允许阻断服务启动；且工作区初始化时
    连接失败的 MCP 会被自动移除，不影响对话主流程。
    """
    raw = os.getenv("NOVAE_MCP_SERVERS")
    if raw is None:
        entries = list(DEFAULT_MCP_SERVERS)
    else:
        raw = raw.strip()
        if not raw:
            return []
        try:
            entries = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning("NOVAE_MCP_SERVERS 不是合法 JSON，已忽略：{}", e)
            return []
        if not isinstance(entries, list):
            logger.warning("NOVAE_MCP_SERVERS 必须是 JSON 数组，已忽略")
            return []

    mcps: list[MCPClient] = []
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("name"):
            logger.warning("MCP 条目缺少 name，已跳过：{}", entry)
            continue
        try:
            if entry.get("command"):
                config = StdioMCPConfig(
                    command=entry["command"],
                    args=entry.get("args"),
                    env=entry.get("env"),
                    cwd=entry.get("cwd"),
                )
            elif entry.get("url"):
                config = HttpMCPConfig(
                    url=entry["url"],
                    headers=entry.get("headers"),
                )
            else:
                logger.warning("MCP 条目需要 command 或 url，已跳过：{}", entry)
                continue
            # is_stateful=True：工具服务器在会话内保持连接，复用进程
            mcps.append(
                MCPClient(
                    name=entry["name"],
                    is_stateful=True,
                    mcp_config=config,
                )
            )
        except Exception as e:
            logger.warning("MCP 条目无效，已跳过：{} ({})", entry, e)
    return mcps