"""Runtime-environment awareness for chat agents.

Appends a ``## 运行环境`` section to the system prompt so the agent can
answer "what is the current absolute path" correctly and report paths in
the OS-native form the user expects. One instance is created per chat run
by the ``extra_agent_middlewares`` factory in ``novae.server``, carrying
that session's project workdir.
"""
import platform

from agentscope.middleware import MiddlewareBase


def os_summary() -> str:
    """Human-readable OS name + release (e.g. ``Windows 11``, ``macOS 15``)."""
    system = platform.system()
    name = {"Darwin": "macOS"}.get(system, system)
    release = platform.release()
    return f"{name} {release}".strip()


class RuntimeEnvMiddleware(MiddlewareBase):
    """Inject OS facts and the project workdir path into the system prompt."""

    def __init__(self, workdir: str) -> None:
        # Absolute path of the session's project working directory.
        self._workdir = workdir

    async def on_system_prompt(self, agent, current_prompt: str) -> str:
        del agent  # not needed — the section is static per instance
        lines = [
            "",
            "## 运行环境",
            f"- 操作系统：{os_summary()}",
        ]
        if platform.system() == "Windows":
            lines.append(
                "- 路径规则：Bash 工具运行在 Git Bash 中，`pwd` 返回 `/c/...` 形式；"
                "向用户汇报路径以及使用文件工具（Read/Write/Edit 等）时，一律使用 "
                "Windows 形式（盘符大写、反斜杠分隔，如 `C:\\data\\...`）。"
            )
        else:
            lines.append(
                "- 路径规则：一律使用 POSIX 绝对路径（如 `/home/user/...`）。"
            )
        lines.append(
            f"- 当前项目工作目录（绝对路径）：`{self._workdir}`。"
            "被问“当前路径 / 绝对路径 / 文件在哪里”时直接回答该路径，不要自行猜测；"
            "所有文件操作均在此目录内进行。"
        )
        return current_prompt + "\n".join(lines)
