import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import { isAxiosError, type AxiosRequestConfig } from "axios";
import * as Lark from "@larksuiteoapi/node-sdk";

import type { BotBridge } from "./bot-bridge.js";
import type { FeishuBridgeConfig } from "./config.js";
import { ConversationQueue } from "./conversation-queue.js";
import {
  OpencodeBridge,
  type PromptFilePartInput,
  type PromptInputPart,
} from "./opencode.js";

interface FeishuMessageEvent {
  sender?: {
    sender_id?: {
      open_id?: string;
    };
    sender_type?: string;
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
}

interface FeishuTextMessageContent {
  text?: unknown;
}

interface FeishuImageMessageContent {
  image_key?: unknown;
}

interface StreamDownloadResponse {
  data: NodeJS.ReadableStream;
  headers: unknown;
}

interface FeishuApiErrorBody {
  code?: unknown;
  msg?: unknown;
  error?: unknown;
}

interface FeishuDownloadRequestConfig extends AxiosRequestConfig {
  $return_headers: true;
}

const IMAGE_PROMPT_TEXT = "用户发送了一张图片。请结合图片内容和现有对话上下文继续回复。";

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
};

function parseTextContent(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(content) as FeishuTextMessageContent;
    if (typeof parsed.text !== "string") {
      return undefined;
    }

    const text = parsed.text.trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function parseImageContent(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(content) as FeishuImageMessageContent;
    return typeof parsed.image_key === "string" && parsed.image_key.trim().length > 0
      ? parsed.image_key.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function extractHeaderValue(headers: unknown, headerName: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (typeof headers === "object" && headers !== null && "get" in headers) {
    const getHeader = headers.get;
    if (typeof getHeader === "function") {
      const value = getHeader.call(headers, headerName) ?? getHeader.call(headers, headerName.toLowerCase());
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
  }

  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== headerName.toLowerCase()) {
      continue;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    if (Array.isArray(value)) {
      const firstString = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (firstString) {
        return firstString;
      }
    }
  }

  return undefined;
}

function normalizeMimeType(value: string | undefined): string {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType && mimeType.length > 0) {
    return mimeType;
  }

  return "image/png";
}

function getFileExtension(mimeType: string): string {
  const mapped = MIME_EXTENSION_MAP[mimeType];
  if (mapped) {
    return mapped;
  }

  if (mimeType.startsWith("image/")) {
    return mimeType.slice("image/".length);
  }

  return "bin";
}

function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return typeof value === "object" && value !== null && "pipe" in value && typeof value.pipe === "function";
}

async function readStreamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8").trim();
}

function formatFeishuApiError(bodyText: string): string {
  if (!bodyText) {
    return "Feishu API returned an empty error body.";
  }

  try {
    const parsed = JSON.parse(bodyText) as FeishuApiErrorBody;
    const code = typeof parsed.code === "number" || typeof parsed.code === "string"
      ? String(parsed.code)
      : undefined;
    const msg = typeof parsed.msg === "string" ? parsed.msg : undefined;

    if (code || msg) {
      return `Feishu API error${code ? ` code=${code}` : ""}${msg ? ` msg=${msg}` : ""}`;
    }
  } catch {
    // Fall back to raw body text below.
  }

  return `Feishu API error body: ${bodyText}`;
}

async function toDetailedFeishuError(error: unknown, fallbackMessage: string): Promise<Error> {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error : new Error(fallbackMessage);
  }

  const responseData = error.response?.data;
  if (isReadableStream(responseData)) {
    try {
      const bodyText = await readStreamText(responseData);
      return new Error(`${fallbackMessage}. ${formatFeishuApiError(bodyText)}`);
    } catch (streamError) {
      const streamMessage = streamError instanceof Error ? streamError.message : String(streamError);
      return new Error(`${fallbackMessage}. Failed to read Feishu error body: ${streamMessage}`);
    }
  }

  return error;
}

export class FeishuBridge implements BotBridge {
  private readonly client;
  private readonly wsClient;
  private readonly eventDispatcher;
  private readonly queue = new ConversationQueue();
  private readonly recentMessageIds = new Set<string>();
  private readonly recentMessageOrder: string[] = [];
  private readonly mediaDirectoryPath: string;

  public constructor(
    private readonly config: FeishuBridgeConfig,
    private readonly opencodeBridge: OpencodeBridge,
  ) {
    const baseConfig = {
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: Lark.Domain.Feishu,
    };

    this.client = new Lark.Client(baseConfig);
    this.wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel: Lark.LoggerLevel.info,
    });
    this.mediaDirectoryPath = path.join(path.dirname(config.sessionStorePath), "feishu-media");
    this.eventDispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": (event) => {
        void this.handleMessage(event);
      },
    });
  }

  public async start(): Promise<void> {
    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
    console.log("[Feishu] Long connection started.");
  }

  public async stop(): Promise<void> {
    this.wsClient.close({ force: true });
  }

  private async handleMessage(event: FeishuMessageEvent): Promise<void> {
    const message = event.message;
    const messageId = message?.message_id;

    if (!message || !messageId || this.isDuplicateMessage(messageId)) {
      return;
    }

    if (event.sender?.sender_type && event.sender.sender_type !== "user") {
      console.warn(`[Feishu] Ignoring sender type: ${event.sender.sender_type}`);
      return;
    }

    const userId = event.sender?.sender_id?.open_id;
    if (!userId) {
      console.warn("[Feishu] Ignoring message without sender open_id.");
      return;
    }

    if (!this.isAllowedUser(userId)) {
      console.warn(`[Feishu] Ignoring unauthorized open_id: ${userId}`);
      return;
    }

    if (!message.chat_id) {
      console.warn(`[Feishu] Ignoring message without chat_id from ${userId}.`);
      return;
    }

    if (message.message_type !== "text" && message.message_type !== "image") {
      console.warn(
        `[Feishu] Ignoring unsupported message type ${message.message_type ?? "unknown"} from ${userId}.`,
      );
      return;
    }

    const conversationKey = this.getConversationKey(message, userId);

    await this.queue.run(conversationKey, async () => {
      await this.sendTextMessage(message, "已收到，正在调用 OpenCode…");

      try {
        const promptParts = await this.buildPromptParts(message, userId);
        if (!promptParts) {
          return;
        }

        const reply = await this.opencodeBridge.promptConversation(conversationKey, promptParts);
        await this.sendTextMessage(message, reply);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown error";
        console.error("[Feishu] Failed to process message:", error);
        await this.sendTextMessage(message, `处理失败：${messageText}`);
      }
    });
  }

  private async buildPromptParts(
    message: NonNullable<FeishuMessageEvent["message"]>,
    userId: string,
  ): Promise<PromptInputPart[] | undefined> {
    if (message.message_type === "text") {
      const text = parseTextContent(message.content);
      if (!text) {
        console.warn(`[Feishu] Ignoring empty text message from ${userId}.`);
        return undefined;
      }

      return [{ type: "text", text }];
    }

    if (message.message_type === "image") {
      const imageKey = parseImageContent(message.content);
      if (!imageKey) {
        console.warn(`[Feishu] Ignoring image message without image_key from ${userId}.`);
        return undefined;
      }

      const imagePart = await this.downloadImagePart(message.message_id ?? "", imageKey);
      return [
        { type: "text", text: IMAGE_PROMPT_TEXT },
        imagePart,
      ];
    }

    return undefined;
  }

  private async downloadImagePart(
    messageId: string,
    imageKey: string,
  ): Promise<PromptFilePartInput> {
    if (!messageId) {
      throw new Error("Feishu image message missing message_id.");
    }

    await fs.mkdir(this.mediaDirectoryPath, { recursive: true });

    const requestConfig: FeishuDownloadRequestConfig = {
      method: "GET",
      url: `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}`,
      params: {
        type: "image",
      },
      responseType: "stream",
      $return_headers: true,
    };

    let resource: StreamDownloadResponse;

    try {
      resource = await this.client.request<StreamDownloadResponse>(requestConfig);
    } catch (error) {
      throw await toDetailedFeishuError(
        error,
        `Failed to download Feishu image resource for message_id=${messageId} image_key=${imageKey}`,
      );
    }

    const mimeType = normalizeMimeType(extractHeaderValue(resource.headers, "content-type"));
    const extension = getFileExtension(mimeType);
    const fileName = `${sanitizeFileNamePart(messageId)}-${sanitizeFileNamePart(imageKey)}.${extension}`;
    const filePath = path.join(this.mediaDirectoryPath, fileName);

    await pipeline(resource.data, nodeFs.createWriteStream(filePath));

    return {
      type: "file",
      mime: mimeType,
      filename: fileName,
      url: pathToFileURL(filePath).href,
    };
  }

  private async sendTextMessage(
    message: NonNullable<FeishuMessageEvent["message"]>,
    text: string,
  ): Promise<void> {
    if (message.chat_type === "p2p") {
      await this.client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: message.chat_id ?? "",
          content: JSON.stringify({ text }),
          msg_type: "text",
        },
      });
      return;
    }

    if (!message.message_id) {
      throw new Error("Feishu group message missing message_id.");
    }

    await this.client.im.v1.message.reply({
      path: {
        message_id: message.message_id,
      },
      data: {
        content: JSON.stringify({ text }),
        msg_type: "text",
      },
    });
  }

  private getConversationKey(
    message: NonNullable<FeishuMessageEvent["message"]>,
    userId: string,
  ): string {
    if (message.chat_type === "group") {
      return `feishu:group:${message.chat_id ?? "unknown-chat"}:user:${userId}`;
    }

    return `feishu:p2p:${userId}`;
  }

  private isAllowedUser(userId: string): boolean {
    return (
      this.config.feishu.allowedUserIds.size === 0 ||
      this.config.feishu.allowedUserIds.has(userId)
    );
  }

  private isDuplicateMessage(messageId: string): boolean {
    if (this.recentMessageIds.has(messageId)) {
      return true;
    }

    this.recentMessageIds.add(messageId);
    this.recentMessageOrder.push(messageId);

    while (this.recentMessageOrder.length > 1000) {
      const oldest = this.recentMessageOrder.shift();
      if (oldest) {
        this.recentMessageIds.delete(oldest);
      }
    }

    return false;
  }
}
