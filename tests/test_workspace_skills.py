"""内置技能播种测试。

会话中技能真正生效的链路：ChatService 组装 agent 时通过
``get_toolkit`` 读取 ``workspace.list_skills()``（工作区
``<workdir>/skills/`` 目录），而不是 agents.py 中 bio_agent 实例上
挂的 loader。因此技能必须经 ``ProjectWorkspaceManager(skill_paths=...)``
播种进每个项目工作区。本文件守护这条链路。
"""

import asyncio
import os

from novae.config import ROOT_DIR, get_builtin_skill_paths
from novae.workspace import ProjectWorkspaceManager

# 仓库内置技能（skills/ 下按类别分目录，共 13 个）
REPO_SKILL_NAMES = {
    "docx", "xlsx", "pdf",  # office
    "ai4s-agent", "research-explorer", "literature-survey",
    "experiment-suite", "paper-writer", "integrity-auditor",
    "mindmap-render",  # research
    "domain-check", "large-file", "publication-figures",  # scientific
}


def _repo_skill_paths() -> list[str]:
    """只取仓库内置技能（排除用户级 ~/.agents/skills，避免环境差异）。"""
    root = str(ROOT_DIR)
    return [p for p in get_builtin_skill_paths() if p.startswith(root)]


def test_builtin_skill_paths_cover_all_repo_skills():
    """枚举到的路径覆盖全部 13 个内置技能，且每个都含 SKILL.md。"""
    paths = _repo_skill_paths()
    names = {os.path.basename(p) for p in paths}
    assert REPO_SKILL_NAMES <= names, REPO_SKILL_NAMES - names
    for p in paths:
        assert os.path.isfile(os.path.join(p, "SKILL.md")), p


def test_workspace_seeds_builtin_skills(tmp_path):
    """新建工作区初始化后，内置技能被复制进 <workdir>/skills/ 且可列出。"""
    mgr = ProjectWorkspaceManager(
        basedir=str(tmp_path),
        skill_paths=_repo_skill_paths(),
    )
    try:
        ws = asyncio.run(mgr.create_workspace("admin", "bio", "s1"))
        skills = asyncio.run(ws.list_skills())
        names = {s.name for s in skills}
        assert REPO_SKILL_NAMES <= names, REPO_SKILL_NAMES - names

        # 技能目录确实复制到了工作区（含辅助文件，以图表样式文件为例）
        skills_dir = tmp_path / "admin" / ws.workspace_id / "skills"
        assert (skills_dir / "docx" / "SKILL.md").is_file()
        assert (
            skills_dir / "publication-figures" / "novae.mplstyle"
        ).is_file()
    finally:
        asyncio.run(mgr.close_all())


def test_existing_workspace_gets_seeded_on_reopen(tmp_path):
    """已有工作区（初始化时无技能）在下次初始化时补播技能。

    模拟升级前创建的工作区：先以空 skill_paths 初始化，再以完整
    skill_paths 重新初始化（服务重启后的缓存未命中路径），技能应补齐。
    """
    mgr = ProjectWorkspaceManager(basedir=str(tmp_path), skill_paths=[])
    ws = asyncio.run(mgr.create_workspace("admin", "bio", "s1"))
    wid = ws.workspace_id
    assert asyncio.run(ws.list_skills()) == []
    asyncio.run(mgr.close_all())

    mgr2 = ProjectWorkspaceManager(
        basedir=str(tmp_path),
        skill_paths=_repo_skill_paths(),
    )
    try:
        ws2 = asyncio.run(mgr2.get_workspace("admin", "bio", "s1", wid))
        names = {s.name for s in asyncio.run(ws2.list_skills())}
        assert REPO_SKILL_NAMES <= names, REPO_SKILL_NAMES - names
    finally:
        asyncio.run(mgr2.close_all())
