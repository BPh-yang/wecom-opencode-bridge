# WeCom ↔ OpenCode Bridge

一个最小可用的桥接服务：

- 使用 `@wecom/aibot-node-sdk` 连接企业微信 AI 机器人长连接
- 使用 `@opencode-ai/sdk` 连接已经启动的 `opencode serve`
- 将企业微信会话映射为 OpenCode session
- 收到文本消息后转发给 OpenCode，并把最终回复发回企业微信

## 当前实现范围

- 文本消息
- 私聊 / 群聊（群聊按“群 + 用户”隔离上下文）
- OpenCode 会话持久化映射到本地 JSON
- 企业微信欢迎语（可选）
- 最终回复模式（不是 SSE 流式透传 OpenCode 中间步骤）

## 前置条件

1. Node.js 20+
2. 企业微信 AI 机器人 `botId` / `secret`
3. 已安装并可运行 OpenCode

## 运行方式

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制示例文件：

```bash
copy .env.example .env
```

然后填写：

- `WECOM_BOT_ID`
- `WECOM_BOT_SECRET`
- `OPENCODE_BASE_URL`（默认 `http://127.0.0.1:4096`）

### 3. 启动 OpenCode 服务

在你希望机器人操作的项目目录下启动：

```bash
opencode serve
```

> 建议：在目标项目目录里执行 `opencode serve`，这样桥接过来的 session 会直接落在该项目上下文里。

### 4. 启动桥接服务

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `WECOM_BOT_ID` | 是 | - | 企业微信 AI 机器人 ID |
| `WECOM_BOT_SECRET` | 是 | - | 企业微信 AI 机器人 Secret |
| `OPENCODE_BASE_URL` | 否 | `http://127.0.0.1:4096` | OpenCode 服务地址 |
| `OPENCODE_MODEL_PROVIDER` | 否 | - | 指定模型 provider |
| `OPENCODE_MODEL_ID` | 否 | - | 指定模型 ID |
| `WECOM_ALLOWED_USER_IDS` | 否 | 空 | 允许访问的企微用户 ID，逗号分隔 |
| `WECOM_WELCOME_MESSAGE` | 否 | 示例欢迎语 | 用户进入单聊时发送的欢迎语 |
| `SESSION_STORE_PATH` | 否 | `.data/sessions.json` | 会话映射持久化文件 |

## 会话映射策略

- 私聊：`single:{userid}`
- 群聊：`group:{chatid}:user:{userid}`

群聊按“群 + 用户”隔离，是为了避免多人在同一群里共用一个 OpenCode 上下文。

## 已知限制

- 目前只处理文本消息
- 目前发送的是“最终回复”，没有把 OpenCode 的思考 / 工具调用实时流式转发到企业微信
- 需要你自己先启动 `opencode serve`

## 后续可扩展方向

- 接入 OpenCode SSE 事件，实现更完整的流式回传
- 支持图片 / 文件消息
- 支持企微卡片和主动推送
- 支持 `/new`、`/abort` 等命令式控制
