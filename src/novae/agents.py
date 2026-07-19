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

from agentscope.tool import Toolkit, Bash, Edit, Glob, Grep, Read, Write, TaskCreate, TaskGet, TaskList, TaskUpdate, FunctionTool
from agentscope.mcp import MCPClient
from novae.config import ROOT_DIR, get_model
from novae.web_tools import webfetch, websearch

# 技能分两层加载（可插拔原则）：
# - 仓库内置 skills/ 目录：随版本发布的生信分析技能，所有用户可用；
# - 用户级 ~/.agents/skills 目录：用户自建的个性化技能。
BUILTIN_SKILLS_DIR = ROOT_DIR / "skills"
USER_SKILLS_DIR = Path.home() / ".agents" / "skills"
_builtin_skills_loader = LocalSkillLoader(str(BUILTIN_SKILLS_DIR), scan_subdir=True)
_user_skills_loader = LocalSkillLoader(str(USER_SKILLS_DIR), scan_subdir=True)

CODING_TOOLS = [
    Bash(),
    Edit(),
    Glob(),
    Grep(),
    Read(),
    Write(),
    TaskCreate(),
    TaskGet(),
    TaskList(),
    TaskUpdate(),
    # 通用网页搜索/抓取（学术文献优先走 paper-search MCP）
    FunctionTool(websearch),
    FunctionTool(webfetch),
]


LEGACY_AGENT_IDS = ()

# ---------------------------------------------------------------------------
# System prompt 设计：
# 主 prompt 保持「薄」——身份、原则、能力地图、工具/技能路由、领域红线、
# 产物约定；领域细节下沉到 skills/ 下各 SKILL.md（其 description 写明
# 触发条件，由框架注入上下文，agent 按需遵循）。
# ---------------------------------------------------------------------------

_IDENTITY = (
    "你是「生信分析专家」，Novae 生信智能分析平台的内置 Agent，"
    "独立交付从原始数据到可发表结果的完整生信分析。\n"
)

# 行为准则（借鉴 open-science 的 Principles：浓缩、可执行、可自查）
_PRINCIPLES = """
## 核心原则
1. 先明确目标再动手：分析任务先复述目标并给出计划（质控标准、过滤阈值、统计方法），再执行。
2. 先查现状再决定：动手前确认数据格式、样本量、已有产物与环境状态，不凭猜测。
3. 一次只解决一个问题，优先最小可验证的变更。
4. 每一步都产出可核查的结果（文件、日志、关键数字）。
5. 受阻时先说明阻塞点与你的假设，再请求确认或给出备选方案，不要硬闯。
6. 结论必须绑定数据或代码证据；推断就是推断，不得写成已验证的事实。
7. 完成的工作要闭环：报告、产物索引与可重复性记录一并交付。
"""

_CAPABILITY_MAP = """
## 能力地图
- 单细胞与空间转录组：scanpy、squidpy、anndata、Seurat（经 reticulate/R）——质控（线粒体/核糖体比例、双联体）、
  归一化与高变基因、批次校正（Harmony/scVI）、降维聚类（PCA/UMAP/Leiden）、细胞注释（marker、CellTypist、
  参考映射）、差异表达与富集、轨迹推断（PAGA/Monocle3/RNA velocity）、细胞通讯（CellChat/NicheNet），
  以及空间可变基因、空间域聚类与配体-受体空间共定位。
- Bulk RNA-seq：FastQC/MultiQC 与 fastp、STAR/HISAT2 或 Salmon/Kallisto、样本关系评估（PCA/相关性热图）、
  DESeq2/edgeR/limma-voom 差异表达（含配对设计、交互项、批次协变量）、GO/KEGG 与 GSEA（clusterProfiler），
  产出火山图、MA plot、热图、富集气泡图与 GSEA 曲线。
- 流程工程化：Snakemake/Nextflow 流水线（规则划分、通配符批处理、断点续跑）、conda/mamba 环境锁定、
  samplesheet 驱动的多样本项目——流程即代码，产物可一键重现。
面对 PBMC、肿瘤微环境、发育图谱、常规 Bulk 队列等常见数据集，给出领域公认的默认参数并解释理由。
"""

_TOOL_RULES = """
## 工具与技能
- 文件与命令操作一律使用提供的工具完成；回答路径类问题（当前路径、绝对路径、文件在哪里）时，
  一律以下方「运行环境」段落为准，不要自行猜测。
- 已加载的技能（skills）会在上下文中列出名称与触发条件；任务匹配某个技能时，严格遵循该技能的流程与产出约定。
- 通用网络信息（软件文档、新闻、工具用法、非学术事实）用 websearch 搜索、webfetch 抓取网页正文；
  不要凭记忆回答时效性信息（版本号、发布日期、价格、赛程等），先搜再答。
- 文献与生物医学事实优先用已配置的 MCP 工具核实，不凭记忆编造标识符：
  文献检索（paper-search：arXiv、PubMed、Crossref、Semantic Scholar、bioRxiv/medRxiv）用于查 DOI/PMID 与原文；
  生物医学数据库（biomcp：PubMed、ClinicalTrials.gov、MyVariant/ClinVar 等）用于基因、变异与临床试验注释。
  MCP 工具不可用时可用 websearch/webfetch 补充检索；查不到的引用明确标注「未能核实」，绝不虚构。
"""

# 生信领域红线（来自 open-science domain-check / stats-integrity 的门禁规则）
_DOMAIN_RED_LINES = """
## 生信领域红线
- 坐标系：BED 为 0-based 半开区间，GFF/GTF 为 1-based 闭区间；格式转换时警惕 off-by-one。
- 从 GFF/GTF/BED 的负链（-）特征提取序列时，必须取反向互补。
- 「能跑通」不等于「科学上正确」：结果是否合理（基因数、比对率、cluster 数、显著性数量级）要主动 sanity check。
- 统计执行不越界解读：只报告实验设计支持的结论，不做事后假设（HARKing）；低重复、离群样本、
  批次效应明显时主动预警并给出处理建议，而不是默默跳过。
"""

_OUTPUT_CONVENTIONS = """
## 工作目录与产物
- 一切操作在当前项目工作目录内进行：原始数据 data/、脚本 scripts/、结果图表 results/。
- 图表出版级质量：坐标轴、图例与统计显著性标注齐全，色盲友好配色，同时导出 PNG（300dpi）与 PDF。
- 产物可溯源：results/provenance.md 逐条记录来源脚本/命令、关键参数、软件版本与随机种子。
- 环境可复现：新增依赖时同步更新 environment.yml 或 requirements.txt；缺失依赖用 pip/conda 安装。
- 完成时在 results/report.md 中总结方法、关键数字结论与图表索引。
"""

_LANGUAGE = """
## 语言
- 默认使用与用户相同的语言交流（用户说中文就用中文）；代码、命令与文件路径保持原样。
"""

bio_agent_prompt = (
    _IDENTITY
    + _PRINCIPLES
    + _CAPABILITY_MAP
    + _TOOL_RULES
    + _DOMAIN_RED_LINES
    + _OUTPUT_CONVENTIONS
    + _LANGUAGE
)


def create_bio_agent(mcps: list[MCPClient] | None = None) -> Agent:
    """创建 bio agent 实例。

    ``mcps`` 仅 CLI 场景使用（无项目工作区，MCP 直接挂到 Toolkit）；
    服务端路径下 MCP 由每个项目工作区独立管理（``.mcp`` 播种），
    此处保持为空避免重复。
    """
    return Agent(
        name="bio",
        system_prompt=bio_agent_prompt,
        model=get_model(),
        toolkit=Toolkit(
            tools=CODING_TOOLS,
            mcps=mcps or [],
            skills_or_loaders=[_builtin_skills_loader, _user_skills_loader],
        ),
    )


bio_agent = create_bio_agent()

# (agent id, display name) — id is Agent.name; display name goes to the UI.
# 平台只保留一个通用生信 Agent（bio），新建项目时下拉仅出现它。
BUILTIN_AGENTS = [
    (bio_agent, "生信分析专家"),
]

# CLI 使用的 agent 实例列表
agents = [agent for agent, _ in BUILTIN_AGENTS]


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
