# Novae 内置技能库

随版本发布的技能，所有用户的 bio agent 均可使用（另支持用户级
`~/.agents/skills` 目录扩展）。按类别组织，加载器递归扫描子目录，
新增技能时放入对应类别目录即可。

## 目录分类

| 目录 | 内容 | 来源 |
| --- | --- | --- |
| `office/` | 办公文档：Word（docx）、Excel（xlsx）、PDF 创建与处理 | Kimi 内置技能 |
| `research/` | AI4S 科研流程：选题探索、文献综述、实验套件、论文写作、完整性审查、思维导图、全流程串联 | [ai4s-research/ai4s-skills](https://github.com/ai4s-research/ai4s-skills) |
| `scientific/` | 科学计算规范：领域正确性检查、大文件指针式读取、论文级图表 | [open-science](https://github.com/) runtime/skills |

## 技能格式

每个技能一个目录，含 `SKILL.md`（YAML frontmatter：`name` +
`description`，description 写明"当…时使用"），辅助脚本/模板与
`SKILL.md` 同目录放置。
