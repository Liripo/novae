# Novae

基于 [AgentScope](https://docs.agentscope.io/) 的编程助手。后端使用 AgentScope 的 Agent Service（FastAPI + Redis），前端采用 AgentScope 官方 Web UI（React + Vite）。

## 前置依赖

- Python ≥ 3.13（使用 [uv](https://docs.astral.sh/uv/)）
- Node.js ≥ 20
- Redis（本地或 Docker：`docker run -d -p 6379:6379 redis:7`）

## 初始化

```bash
cp .env.example .env
# 安装包
uv sync
```
## 命令行使用

```bash
uv run novae chat -h
uv run novae chat "你好"
```

## 启动后端

```bash
uv run fastapi dev src/novae/server.py
```

## 启动前端

在另一个终端中执行：

```bash
cd frontend
npm install
npm run dev
```

## 用户管理

默认用户 `admin` / `admin`（role=admin）在首次启动时自动写入 Redis。
生产环境用脚本创建或更新用户，并且暂时需要自己去掉默认管理员的代码。

```bash
uv run python scripts/create_user.py <用户名> <密码> [user|admin]
# 例：创建管理员
uv run python scripts/create_user.py admin <strong-password> admin
```

用户记录保存在 Redis 的 `novae:user:<username>` 键下，密码以 PBKDF2-HMAC-SHA256 哈希存储。

