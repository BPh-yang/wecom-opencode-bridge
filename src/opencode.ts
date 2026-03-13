import { createOpencodeClient } from "@opencode-ai/sdk";

import type { BridgeConfig } from "./config.js";
import { SessionStore } from "./session-store.js";

export interface PromptTextPartInput {
  type: "text";
  text: string;
}

export interface PromptFilePartInput {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
}

export type PromptInputPart = PromptTextPartInput | PromptFilePartInput;

interface TextPart {
  type: string;
  text?: string;
}

interface MessageWithParts {
  parts?: unknown[];
}

interface SessionInfo {
  id: string;
}

interface SessionGetResponse {
  data?: SessionInfo;
  id?: string;
}

interface SessionCreateResponse {
  data?: SessionInfo;
  id?: string;
}

type PromptResponse = {
  data?: {
    parts?: unknown[];
  };
  parts?: unknown[];
};

type MessagesResponse = {
  data?: MessageWithParts[];
} | MessageWithParts[];

const OPENCODE_HEALTHCHECK_TIMEOUT_MS = 10000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextPart(value: unknown): value is TextPart {
  if (!isObject(value)) {
    return false;
  }

  const type = value.type;
  const text = value.text;

  return type === "text" && (typeof text === "string" || typeof text === "undefined");
}

function extractTextFromParts(parts: unknown[] | undefined): string | undefined {
  if (!Array.isArray(parts)) {
    return undefined;
  }

  const collected = parts
    .filter(isTextPart)
    .map((part) => part.text?.trim() ?? "")
    .filter((text) => text.length > 0);

  if (collected.length === 0) {
    return undefined;
  }

  return collected.join("\n\n");
}

function extractTextFromPromptResponse(response: PromptResponse): string | undefined {
  return extractTextFromParts(response.data?.parts) ?? extractTextFromParts(response.parts);
}

function extractMessages(response: MessagesResponse): MessageWithParts[] {
  if (Array.isArray(response)) {
    return response;
  }

  return Array.isArray(response.data) ? response.data : [];
}

function extractTextFromMessagesResponse(response: MessagesResponse): string | undefined {
  const messages = extractMessages(response);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = extractTextFromParts(messages[index]?.parts);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractSessionId(response: SessionGetResponse | SessionCreateResponse): string | undefined {
  return response.data?.id ?? response.id;
}

function getSessionTitlePrefix(provider: BridgeConfig["botProvider"]): string {
  return provider === "wecom" ? "WeCom" : "Feishu";
}

async function withHealthCheckTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`OpenCode health check timed out after ${OPENCODE_HEALTHCHECK_TIMEOUT_MS}ms.`));
        }, OPENCODE_HEALTHCHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function truncateReply(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) {
    return text;
  }

  const suffix = "\n\n[已截断：回复超过机器人展示长度限制]";
  return `${text.slice(0, maxLength - suffix.length)}${suffix}`;
}

export class OpencodeBridge {
  private readonly client;

  public constructor(
    private readonly config: BridgeConfig,
    private readonly sessionStore: SessionStore,
  ) {
    this.client = createOpencodeClient({
      baseUrl: config.opencodeBaseUrl,
      throwOnError: true,
    });
  }

  public async healthCheck(): Promise<void> {
    await withHealthCheckTimeout(this.client.path.get());
  }

  public async promptConversation(
    conversationKey: string,
    parts: PromptInputPart[],
  ): Promise<string> {
    if (parts.length === 0) {
      throw new Error("OpenCode prompt requires at least one part.");
    }

    const sessionId = await this.getOrCreateSessionId(conversationKey);
    const promptResponse = (await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        ...(this.config.opencodeModelProvider && this.config.opencodeModelId
          ? {
              model: {
                providerID: this.config.opencodeModelProvider,
              modelID: this.config.opencodeModelId,
              },
            }
          : {}),
        parts,
      },
    })) as PromptResponse;

    const directText = extractTextFromPromptResponse(promptResponse);
    if (directText) {
      return truncateReply(directText);
    }

    const messagesResponse = (await this.client.session.messages({
      path: { id: sessionId },
    })) as MessagesResponse;
    const fallbackText = extractTextFromMessagesResponse(messagesResponse);

    if (fallbackText) {
      return truncateReply(fallbackText);
    }

    throw new Error("OpenCode returned no text content for the latest prompt.");
  }

  private async getOrCreateSessionId(conversationKey: string): Promise<string> {
    const existingId = this.sessionStore.getSessionId(conversationKey);
    if (existingId) {
      const stillExists = await this.sessionExists(existingId);
      if (stillExists) {
        return existingId;
      }
    }

    const created = (await this.client.session.create({
      body: {
        title: `${getSessionTitlePrefix(this.config.botProvider)} ${conversationKey}`,
      },
    })) as SessionCreateResponse;

    const sessionId = extractSessionId(created);
    if (!sessionId) {
      throw new Error("OpenCode session.create returned no session ID.");
    }

    await this.sessionStore.setSessionId(conversationKey, sessionId);
    return sessionId;
  }

  private async sessionExists(sessionId: string): Promise<boolean> {
    try {
      const session = (await this.client.session.get({
        path: { id: sessionId },
      })) as SessionGetResponse;
      return Boolean(extractSessionId(session));
    } catch {
      return false;
    }
  }
}
