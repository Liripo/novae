"""Built-in bioinformatics expert agent for the Novae platform.

The platform ships a single comprehensive agent (id ``bio``, display name
「生信分析专家」). ``seed_builtin_agent`` retires every legacy built-in id
and upserts this record for every registered user.
"""
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

# Legacy built-in agent ids retired by the bioinformatics rebrand and the
# later single-agent consolidation. They are deleted (with their
# sessions/schedules) before each seeding run so users only ever see the
# current expert. 注意连字符/下划线两种历史命名都要覆盖。
LEGACY_AGENT_IDS = (
    "scrna",
    "rnaseq",
    "bioflow",
    "novae",
    "novae_optimizer",
    "novae-optimizer",
    "novae-coder",
    "flow",
)

_OUTPUT_CONVENTIONS = """
工作规范：
- 一切操作都在当前项目的工作目录内进行：原始数据放入 data/，脚本放入 scripts/，结果图表放入 results/ 。
- 图表需出版级质量：标注坐标轴、图例与统计显著性，配色清晰（色盲友好），同时导出 PNG（300dpi）与 PDF。
- 关键步骤先制定分析计划（质控标准、过滤阈值、统计方法），执行中记录所用参数与软件版本，保证可重复性。
- 遇到缺失依赖时用 pip/conda 安装；数据异常（格式错误、样本量过小、批次效应明显）要主动指出并给出处理建议，而不是默默跳过。
- 完成时在 results/report.md 中总结方法、关键数字结论与图表索引。"""

bio_agent = Agent(
    name="bio",
    system_prompt=(
        "你是「生信分析专家」，Novae 生信智能分析平台的综合生信 Agent，"
        "能够独立交付从原始数据到可发表结果的完整分析。你的核心能力覆盖三大方向：\n"
        "1. 单细胞与空间转录组：精通 scanpy、squidpy、anndata 与 Seurat（可经 reticulate/R 脚本调用）——"
        "数据读入与质控（10x Cell Ranger 输出、h5ad、mtx 矩阵；线粒体/核糖体基因比例、双联体检测）、"
        "归一化、高变基因选择、批次校正（Harmony/scVI）、降维聚类（PCA/UMAP/Leiden）、"
        "细胞类型注释（经典 marker 基因、CellTypist、参考图谱映射）、差异表达与功能富集、"
        "轨迹推断（PAGA、Monocle3、RNA velocity）、细胞通讯（CellChat/NicheNet），"
        "以及空间转录组的空间可变基因识别、空间域聚类与配体-受体空间共定位；\n"
        "2. Bulk RNA-seq：FastQC/MultiQC 质控与 fastp 修剪、STAR/HISAT2 比对或 Salmon/Kallisto 准定量、"
        "样本间关系评估（PCA、层级聚类、样本相关性热图）、DESeq2/edgeR/limma-voom 差异表达"
        "（含配对设计、交互项与批次协变量）、GO/KEGG 富集与 GSEA（clusterProfiler），"
        "产出火山图、MA plot、热图、富集气泡图与 GSEA 富集曲线；\n"
        "3. 流程搭建：用 Snakemake 或 Nextflow 把分析步骤工程化为可重复流水线（规则划分、输入输出声明、"
        "通配符驱动的多样本批处理、断点续跑），conda/mamba 环境管理与版本锁定，"
        "日志与基准收集，samplesheet 驱动的多样本项目——流程即代码，所有产物可一键重现。\n"
        "面对 PBMC、肿瘤微环境、发育图谱、常规 Bulk 队列等常见数据集时，你能给出领域公认的默认参数并解释理由；"
        "对低重复、离群样本、批次效应明显等情况主动预警。\n"
        "回答路径类问题（当前路径、绝对路径、文件在哪里）时，一律以下方「运行环境」段落为准，不要自行猜测。"
        + _OUTPUT_CONVENTIONS
    ),
    model=get_model(),
    toolkit=Toolkit(
        tools=CODING_TOOLS,
        skills_or_loaders=[_skills_loader],
    ),
)

# (agent id, display name) — id is Agent.name; display name goes to the UI.
# 平台只保留一个通用生信 Agent（bio），新建项目时下拉仅出现它。
BUILTIN_AGENTS = [
    (bio_agent, "生信分析专家"),
]


async def _get_user_ids(app: FastAPI) -> list[str]:
    user_store = getattr(app.state, "novae_user_store", None)
    if user_store is not None:
        return await user_store.list_usernames()
    else:
        return []


async def seed_builtin_agent(app: FastAPI) -> None:
    """为所有已注册用户写入内置 agent 记录（先退役旧内置 id）。"""
    storage: StorageBase = app.state.storage
    user_ids = await _get_user_ids(app)

    for user_id in user_ids:
        # Retire legacy built-in agents (cascades their sessions/schedules).
        for legacy_id in LEGACY_AGENT_IDS:
            try:
                await storage.delete_agent(user_id, legacy_id)
            except Exception:
                # Deletion is best-effort: a partially-missing legacy
                # record must never block seeding.
                pass
        for agent, display_name in BUILTIN_AGENTS:
            record = AgentRecord(
                id=agent.name,
                user_id=user_id,
                source="user",
                data=AgentData(
                    id=agent.name,
                    name=display_name,
                    system_prompt=agent._system_prompt,
                    context_config=ContextConfig(),
                    react_config=ReActConfig(),
                ),
            )
            await storage.upsert_agent(user_id, record)
