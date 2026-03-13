# WeCom / Feishu ↔ OpenCode Bridge

把企业微信或飞书机器人消息，桥接到 `opencode serve`，并把回复发回原会话。

---

## 1) 功能概览

| 平台 | 已支持输入 | 会话类型 | 回包方式 |
| --- | --- | --- | --- |
| 企业微信（WeCom） | 文本 | 私聊、群聊 | `replyStream`（先 ACK，再最终回复） |
| 飞书（Feishu） | 文本、图片 | 单聊、群聊 | 单聊 `create`，群聊 `reply` |

共同能力：

- 通过 `BOT_PROVIDER=wecom|feishu` 切换平台
- 会话映射持久化到本地 JSON（避免上下文丢失）
- 用户白名单控制（可选）
- OpenCode 模型可按环境变量覆盖（可选）

---

## 2) 前置条件

1. Node.js 20+
2. 已安装 OpenCode，并可运行 `opencode serve`
3. 至少准备一种平台凭证：
   - WeCom：`WECOM_BOT_ID` + `WECOM_BOT_SECRET`
   - Feishu：`FEISHU_APP_ID` + `FEISHU_APP_SECRET`

---

## 3) 快速开始

### 3.1 安装依赖

```bash
npm install
```

### 3.2 复制环境变量模板

Windows (PowerShell / CMD)：

```bash
copy .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

### 3.3 按平台填写 `.env`

#### A. 企业微信（WeCom）示例

```env
BOT_PROVIDER=wecom

WECOM_BOT_ID=your-bot-id
WECOM_BOT_SECRET=your-bot-secret

OPENCODE_BASE_URL=http://127.0.0.1:4096

# 可选：只允许这些企业微信 userid
WECOM_ALLOWED_USER_IDS=

# 可选：进入单聊欢迎语
WECOM_WELCOME_MESSAGE=你好，我已连接 OpenCode。请直接发送你的需求。

SESSION_STORE_PATH=.data/sessions.json
```

#### B. 飞书（Feishu）示例

```env
BOT_PROVIDER=feishu

FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=your-feishu-app-secret

OPENCODE_BASE_URL=http://127.0.0.1:4096

# 可选：只允许这些 open_id
FEISHU_ALLOWED_OPEN_IDS=

SESSION_STORE_PATH=.data/sessions.json
```

### 3.4 启动 OpenCode

在你希望机器人操作的项目目录中执行：

```bash
opencode serve
```

### 3.5 启动桥接服务

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm run build
npm start
```

---

## 4) 平台配置说明

## 4.1 企业微信（WeCom）

在企业微信后台需要确认：

1. 机器人已开启 API 模式（长连接）
2. 获取 `botId` / `secret`
3. 机器人已能接收到目标会话消息（私聊或群聊）

本项目使用：`@wecom/aibot-node-sdk` 长连接。

## 4.2 飞书（Feishu）

在飞书开放平台需要确认：

1. 创建自建应用并开启机器人能力
2. 事件订阅包含 `im.message.receive_v1`
3. 订阅方式使用长连接
4. 应用具备收发消息权限
5. 若要处理图片，应用需具备消息资源下载相关权限（否则图片下载会 400）
6. 发布应用并安装到目标企业/会话

本项目使用：`@larksuiteoapi/node-sdk` 长连接。

---

## 5) 环境变量说明

| 变量 | 必填条件 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `BOT_PROVIDER` | 否 | `wecom` | 仅支持 `wecom` / `feishu` |
| `OPENCODE_BASE_URL` | 否 | `http://127.0.0.1:4096` | OpenCode 服务地址 |
| `OPENCODE_MODEL_PROVIDER` | 与 `OPENCODE_MODEL_ID` 成对 | 空 | 覆盖模型 provider |
| `OPENCODE_MODEL_ID` | 与 `OPENCODE_MODEL_PROVIDER` 成对 | 空 | 覆盖模型 ID |
| `SESSION_STORE_PATH` | 否 | `.data/sessions.json` | 会话映射文件路径 |
| `BOT_ALLOWED_USER_IDS` | 否 | 空 | 通用白名单，设置后覆盖平台专属白名单 |
| `BOT_WELCOME_MESSAGE` | 否 | 空 | 通用欢迎语覆盖项（当前仅 WeCom 使用） |
| `WECOM_BOT_ID` | `BOT_PROVIDER=wecom` | 无 | 企业微信机器人 ID |
| `WECOM_BOT_SECRET` | `BOT_PROVIDER=wecom` | 无 | 企业微信机器人 Secret |
| `WECOM_ALLOWED_USER_IDS` | 否 | 空 | WeCom 专属白名单（userid，逗号分隔） |
| `WECOM_WELCOME_MESSAGE` | 否 | 空 | WeCom 进入单聊欢迎语 |
| `FEISHU_APP_ID` | `BOT_PROVIDER=feishu` | 无 | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | `BOT_PROVIDER=feishu` | 无 | 飞书应用 App Secret |
| `FEISHU_ALLOWED_OPEN_IDS` | 否 | 空 | Feishu 专属白名单（open_id，逗号分隔） |

### 校验规则

- `BOT_PROVIDER` 不是 `wecom|feishu` 会启动失败
- `OPENCODE_MODEL_PROVIDER` / `OPENCODE_MODEL_ID` 必须同时设置或同时留空
- 当 `BOT_ALLOWED_USER_IDS` 非空时，优先使用它，不再看平台专属白名单

---

## 6) 运行行为（你会关心的细节）

### 6.1 OpenCode 连接

- 启动时会做一次 health check（10 秒超时保护）
- 正常会话请求不再强制 10 秒超时，可支持较长等待任务（如“2 分钟后提醒我”）

### 6.2 会话映射键

- 企业微信私聊：`single:{userid}`
- 企业微信群聊：`group:{chatid}:user:{userid}`
- 飞书单聊：`feishu:p2p:{open_id}`
- 飞书群聊：`feishu:group:{chat_id}:user:{open_id}`

群聊按“群 + 用户”隔离，避免多人共享同一 OpenCode 上下文。

### 6.3 飞书图片缓存目录

- 飞书图片会先下载到本地，再作为 file part 传给 OpenCode
- 缓存目录：`dirname(SESSION_STORE_PATH)/feishu-media`
  - 默认即 `.data/feishu-media`

---

## 7) 已知限制

- 企业微信当前仅处理文本消息
- 飞书当前处理文本与图片消息
- 目前回传的是“最终回复”，不转发 OpenCode 中间思考/工具流
- 飞书群聊使用 reply 原消息方式返回（不是单条流式更新）
- 飞书暂无与 WeCom `enter_chat` 对应的欢迎事件处理

---

## 8) 常见问题排查

### 8.1 启动卡在 OpenCode 检查

- 确认 `opencode serve` 已启动
- 确认 `OPENCODE_BASE_URL` 可访问（默认 `http://127.0.0.1:4096`）

### 8.2 飞书图片下载返回 400

先看日志中的 Feishu 错误码与消息（本项目会输出详细错误体）。常见原因：

- 应用没有图片/消息资源下载权限
- 图片资源与消息不匹配（`message_id` + `image_key` 组合不正确）
- 应用不在该会话中
- 不支持的消息资源类型（如某些特殊资源）

### 8.3 明明发了消息但机器人不回

- 检查白名单是否误拦截：
  - WeCom 用 `userid`
  - Feishu 用 `open_id`
- 临时清空白名单变量做对比测试

---

## 9) 开发命令

```bash
npm run dev        # 开发运行
npm run typecheck  # 类型检查
npm run build      # 构建
npm start          # 运行 dist
```

---

## 10) 参考文档

- Feishu Open Platform: https://open.feishu.cn/document/
- WeCom 开发者文档: https://developer.work.weixin.qq.com/document/
