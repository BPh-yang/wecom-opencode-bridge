# WeCom ↔ OpenCode Long-Connection Bridge

一个最小可用的桥接服务：

- 使用 `botId + secret` 通过企业微信 AI 机器人 WebSocket 长连接收消息
- 把消息转发给本地运行的 OpenCode
- 复用 OpenCode session 保持上下文
- 把最终文本结果回发到企业微信

## 当前实现范围

- 文本消息收发
- 私聊 / 群聊（群聊按 `chatId:senderId` 隔离 session，避免串上下文）
- 占位回复 + 最终回复
- 消息去重
- 会话 TTL 清理
- 每个会话串行处理，避免并发打乱上下文

未实现：

- 图片 / 文件 / 语音
- 真正的 token 级流式转发
- 持久化 session 映射
- 多实例部署

## 1. 前置条件

- Node.js 20+
- 已创建企业微信 AI 机器人，并拿到：
  - `botId`
  - `secret`
- 本机可启动 OpenCode server

## 2. 启动 OpenCode

先单独启动 OpenCode：

```bash
opencode serve --port 4096
```

默认会连接到：

```text
http://127.0.0.1:4096
```

## 3. 配置环境变量

复制模板：

```bash
copy .env.example .env
```

重点配置：

- `WECOM_BOT_ID`
- `WECOM_BOT_SECRET`
- `OPENCODE_DIRECTORY`

`OPENCODE_DIRECTORY` 要指向 **你希望 OpenCode 实际操作的项目目录**，不是这个 bridge 项目目录。

示例：

```env
WECOM_BOT_ID=xxx
WECOM_BOT_SECRET=yyy
OPENCODE_BASE_URL=http://127.0.0.1:4096
OPENCODE_DIRECTORY=D:/work/my-real-project
```

可选：

- `OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514`
- `OPENCODE_AGENT=build`
- `OPENCODE_SYSTEM_PROMPT=...`

## 4. 开发运行

```bash
npm run dev
```

## 5. 构建与生产运行

```bash
npm run build
npm start
```

## 6. 会话映射规则

- 单聊：`senderId -> OpenCode sessionId`
- 群聊：`chatId:senderId -> OpenCode sessionId`

这样群里不同用户不会共用同一个 OpenCode 上下文。

## 7. 关键行为

### 占位回复

默认会先发一条：

```text
已收到，正在处理...
```

然后再发最终结果。

如果不需要，占位消息可设为空字符串：

```env
WECOM_PLACEHOLDER_MESSAGE=
```

### OpenCode session 丢失自动恢复

如果 OpenCode 返回 session 不存在，bridge 会：

1. 重新创建 session
2. 自动重试当前消息一次

## 8. 安全建议

- `opencode serve` 只绑定本机地址
- 不要把 `.env` 提交到仓库
- 生产环境建议把 bridge 和 OpenCode 都放到受控主机上
- 如果你不希望远程聊天直接触发高权限工具，请在 OpenCode 侧单独限制模型 / agent / tools

## 9. 后续可扩展方向

- 企微流式输出
- `/new` 重置会话
- `/session` 查看当前 session
- 群聊 @ 机器人过滤
- 图片 / 文件透传
- 持久化 session 存储（SQLite / Redis）
