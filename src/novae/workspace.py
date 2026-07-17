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
import os
import re
import time
import uuid

from agentscope.app.workspace_manager import LocalWorkspaceManager
from agentscope.workspace import LocalWorkspace

_SAFE_COMPONENT = re.compile(r"^[a-zA-Z0-9_-]+$")


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
