"""Project-scoped local workspace manager for Novae.

Replaces AgentScope's agent-keyed layout (``basedir/<agent_id>``) with a
user/project-keyed layout::

    basedir/<user_id>/<workspace_id>

where ``workspace_id`` equals the owning project's id for project-bound
sessions (legacy sessions keep their random hex ``workspace_id`` and
simply get a fresh, empty working directory on first use).

Both ``user_id`` and ``workspace_id`` are validated against a strict
allowlist so no path component can escape ``basedir``.
"""
import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path

from agentscope.app.workspace_manager import LocalWorkspaceManager
from agentscope.workspace import LocalWorkspace
from loguru import logger

from novae.config import get_builtin_mcps

_SAFE_COMPONENT = re.compile(r"^[a-zA-Z0-9_-]+$")

# 一次性 .mcp 修复的完成标记（写在 workspace_root 下）
_MCP_REPAIR_MARKER = ".mcp_repair_v1"


def repair_workspace_mcps(workspace_root: str | Path) -> int:
    """一次性修复：把缺失的内置 MCP 按名称补回各工作区的 ``.mcp`` 文件。

    历史 bug：默认 MCP（paper-search / biomcp）以 ``uvx`` 启动，在只有
    ``uv`` 的机器上连接失败，被 agentscope 的工作区初始化静默移除并
    持久化为空 ``.mcp``——此后默认列表不再播种。本函数在首次启动时
    （以 marker 文件为记）遍历 ``<root>/<user>/<ws>/.mcp``，把缺失的
    默认 MCP 补回；marker 写完即不再运行，因此用户之后主动删除的
    MCP 不会被复活。任何单文件失败只记警告，绝不阻断服务启动。

    返回补写过的 ``.mcp`` 文件数量。
    """
    root = Path(workspace_root)
    marker = root / _MCP_REPAIR_MARKER
    if marker.exists():
        return 0
    repaired = 0
    try:
        defaults = get_builtin_mcps()
        if defaults:
            for mcp_file in root.glob("*/*/.mcp"):
                try:
                    entries = json.loads(mcp_file.read_text(encoding="utf-8"))
                    if not isinstance(entries, list):
                        continue
                    names = {
                        e.get("name") for e in entries if isinstance(e, dict)
                    }
                    added = False
                    for mcp in defaults:
                        if mcp.name not in names:
                            entries.append(mcp.model_dump(mode="json"))
                            added = True
                    if added:
                        mcp_file.write_text(
                            json.dumps(entries, indent=2, ensure_ascii=False),
                            encoding="utf-8",
                        )
                        repaired += 1
                except Exception as e:
                    logger.warning("修复 {} 失败，已跳过：{}", mcp_file, e)
        if repaired:
            logger.info("已为 {} 个工作区补回内置 MCP 配置", repaired)
    finally:
        try:
            marker.touch()
        except Exception as e:
            logger.warning("写入 MCP 修复标记失败：{}", e)
    return repaired


class ProjectWorkspaceManager(LocalWorkspaceManager):
    """LocalWorkspaceManager keyed by ``(user_id, workspace_id)``."""

    def _workdir(self, user_id: str, workspace_id: str) -> str:
        """Resolve the working directory for a (user, workspace) pair.

        Raises:
            `ValueError`: If either path component contains characters
                outside ``[a-zA-Z0-9_-]`` (path traversal guard).
        """
        if not _SAFE_COMPONENT.match(user_id):
            raise ValueError(f"Invalid user id: {user_id!r}")
        if not _SAFE_COMPONENT.match(workspace_id):
            raise ValueError(f"Invalid workspace id: {workspace_id!r}")
        return os.path.join(self._basedir, user_id, workspace_id)

    async def get_workspace(
        self,
        user_id: str,
        agent_id: str,
        session_id: str,
        workspace_id: str,
    ) -> LocalWorkspace:
        """Return an initialized workspace, reconstructing from
        ``basedir/<user_id>/<workspace_id>`` on cache miss.

        Mirrors the parent's double-check locking pattern exactly; only
        the workdir computation differs.
        """
        del agent_id, session_id  # accepted for interface parity

        workdir = self._workdir(user_id, workspace_id)

        # Phase 1: cache hit + collect expired.
        async with self._lock:
            now = time.monotonic()
            expired = self._pop_expired(now)
            cached = self._cache.get(workspace_id)
            if cached is not None:
                ws, _ = cached
                self._cache[workspace_id] = (ws, now)
                hit: LocalWorkspace | None = ws
            else:
                hit = None

        # Phase 2: close expired entries outside the lock.
        if expired:
            await asyncio.gather(
                *(self._safe_close(ws) for ws in expired),
                return_exceptions=True,
            )

        if hit is not None:
            return hit

        # Phase 3: build under the lock to prevent duplicate instances
        # for the same workspace_id.
        async with self._lock:
            cached = self._cache.get(workspace_id)
            if cached is not None:
                ws, _ = cached
                self._cache[workspace_id] = (ws, time.monotonic())
                return ws

            ws = LocalWorkspace(
                workspace_id=workspace_id,
                workdir=workdir,
                default_mcps=self._default_mcps,
                skill_paths=self._skill_paths,
            )
            await ws.initialize()
            self._cache[workspace_id] = (ws, time.monotonic())
            return ws

    async def create_workspace(
        self,
        user_id: str,
        agent_id: str,
        session_id: str,
    ) -> LocalWorkspace:
        """Create a new workspace under ``basedir/<user_id>/<new_id>``."""
        del agent_id, session_id  # accepted for interface parity

        workspace_id = uuid.uuid4().hex
        workdir = self._workdir(user_id, workspace_id)
        os.makedirs(workdir, exist_ok=True)
        ws = LocalWorkspace(
            workspace_id=workspace_id,
            workdir=workdir,
            default_mcps=self._default_mcps,
            skill_paths=self._skill_paths,
        )
        await ws.initialize()
        async with self._lock:
            self._cache[ws.workspace_id] = (ws, time.monotonic())
        return ws
