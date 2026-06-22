# Novae

基于 [Agno](https://docs.agno.com/) 的编程助手，通过 AG-UI 协议对外提供服务，后端使用 FastAPI / AgentOS，前端是基于 CopilotKit 的聊天界面（React + Vite）。


## 配置

复制示例文件并填入你的 API 凭证：

```bash
cp .env.example .env
```


## 启动后端

```bash
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

聊天界面运行在 `http://localhost:5173`。

## 开发说明

- 前端使用 CopilotKit v2 组件，通过 `@ag-ui/client` 直接连接到 Agno 的 AG-UI 端点（`/agui`）。
- `src/novae/main.py` 中已配置 CORS，允许 `http://localhost:5173` 访问后端。
