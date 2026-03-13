import AiBot, { generateReqId, type WsFrame } from "@wecom/aibot-node-sdk";

import type { BridgeConfig } from "./config.js";
import { OpencodeBridge } from "./opencode.js";

interface TextMessageBody {
  msgid: string;
  chatid?: string;
  chattype: "single" | "group";
  from?: {
    userid?: string;
  };
  text?: {
    content?: string;
  };
}

interface EventMessageBody {
  from?: {
    userid?: string;
  };
}

class ConversationQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  public async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = (async () => {
      await previous.then(
        () => undefined,
        () => undefined,
      );
      return task();
    })();

    this.chains.set(
      key,
      current.finally(() => {
        if (this.chains.get(key) === current) {
          this.chains.delete(key);
        }
      }),
    );

    return current;
  }
}

export class WeComBridge {
  private readonly wsClient;
  private readonly queue = new ConversationQueue();
  private readonly recentMessageIds = new Set<string>();
  private readonly recentMessageOrder: string[] = [];

  public constructor(
    private readonly config: BridgeConfig,
    private readonly opencodeBridge: OpencodeBridge,
  ) {
    this.wsClient = new AiBot.WSClient({
      botId: config.wecomBotId,
      secret: config.wecomBotSecret,
    });
  }

  public start(): void {
    this.registerEventHandlers();
    this.wsClient.connect();
  }

  public stop(): void {
    this.wsClient.disconnect();
  }

  private registerEventHandlers(): void {
    this.wsClient.on("connected", () => {
      console.log("[WeCom] WebSocket connected.");
    });

    this.wsClient.on("authenticated", () => {
      console.log("[WeCom] Authenticated successfully.");
    });

    this.wsClient.on("disconnected", (reason: string) => {
      console.warn(`[WeCom] Disconnected: ${reason}`);
    });

    this.wsClient.on("reconnecting", (attempt: number) => {
      console.warn(`[WeCom] Reconnecting, attempt ${attempt}.`);
    });

    this.wsClient.on("error", (error: Error) => {
      console.error("[WeCom] Client error:", error);
    });

    this.wsClient.on("message.text", (frame: WsFrame<TextMessageBody>) => {
      void this.handleTextMessage(frame);
    });

    if (this.config.welcomeMessage) {
      this.wsClient.on("event.enter_chat", (frame: WsFrame<EventMessageBody>) => {
        void this.wsClient.replyWelcome(frame, {
          msgtype: "text",
          text: { content: this.config.welcomeMessage ?? "" },
        });
      });
    }
  }

  private async handleTextMessage(frame: WsFrame<TextMessageBody>): Promise<void> {
    const message = frame.body;
    const messageId = message?.msgid;

    if (!message || !messageId || this.isDuplicateMessage(messageId)) {
      return;
    }

    const userId = message.from?.userid;
    if (!userId) {
      console.warn("[WeCom] Ignoring message without sender userid.");
      return;
    }

    if (!this.isAllowedUser(userId)) {
      console.warn(`[WeCom] Ignoring unauthorized userid: ${userId}`);
      return;
    }

    const text = message.text?.content?.trim();
    if (!text) {
      console.warn(`[WeCom] Ignoring empty text message from ${userId}.`);
      return;
    }

    const conversationKey = this.getConversationKey(message);

    await this.queue.run(conversationKey, async () => {
      const streamId = generateReqId("stream");
      await this.wsClient.replyStream(frame, streamId, "已收到，正在调用 OpenCode…", false);

      try {
        const reply = await this.opencodeBridge.promptConversation(conversationKey, text);
        await this.wsClient.replyStream(frame, streamId, reply, true);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown error";
        console.error("[Bridge] Failed to process message:", error);
        await this.wsClient.replyStream(
          frame,
          streamId,
          `处理失败：${messageText}`,
          true,
        );
      }
    });
  }

  private getConversationKey(message: TextMessageBody): string {
    const userId = message.from?.userid ?? "unknown-user";
    if (message.chattype === "group") {
      return `group:${message.chatid ?? "unknown-chat"}:user:${userId}`;
    }

    return `single:${userId}`;
  }

  private isAllowedUser(userId: string): boolean {
    return this.config.allowedUserIds.size === 0 || this.config.allowedUserIds.has(userId);
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
