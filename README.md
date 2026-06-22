# Novae

基于 [AgentScope](https://docs.agentscope.io/) 的编程助手。后端使用 AgentScope 的 Agent Service（FastAPI + Redis），前端采用 AgentScope 官方 Web UI（React + Vite）。

模型凭证、Agent 配置、会话与工作区都在 Web UI 中管理，无需在后端 .env 中填写 API Key。

## 前置依赖

- Python ≥ 3.13（使用 [uv](https://docs.astral.sh/uv/)）
- Node.js ≥ 20
- Redis（本地或 Docker：`docker run --rm -p 6379:6379 redis:7`）

## 配置

复制示例文件并按需修改 Redis / 工作区路径：

```bash
cp .env.example .env
```

## 启动后端

```bash
uv sync
uv run fastapi dev ./src/novae/main.py
```

后端运行在 `http://localhost:8000`。

## 启动前端

在另一个终端中执行：

```bash
cd frontend
npm install
npm run dev
```

Web UI 运行 `http://localhost:5173`。首次打开用账号登录（默认 `liripo` / `liripo`），然后在「凭证」页面配置模型 API Key 即可开始对话。内置单个 Agent（Novae），内置工具包含 Bash、Read、Write、Edit、Glob、Grep。

## 用户管理

默认用户 `liripo` / `liripo`（role=user）在首次启动时自动写入 Redis。生产环境用脚本创建或更新用户（直接连 Redis，无需后端运行）：

```bash
uv run python scripts/create_user.py <用户名> <密码> [user|admin]
# 例：创建管理员
uv run python scripts/create_user.py admin <strong-password> admin
```

用户记录保存在 Redis 的 `novae:user:<username>` 键下，密码以 PBKDF2-HMAC-SHA256 哈希存储。

## 说明

- `src/novae/main.py` 通过 `agentscope.app.create_app` 组装 Agent Service，包含 agent / chat / session / workspace / credential / schedule / model 等路由。
- 已配置 CORS，允许 `http://localhost:5173` 访问后端。
