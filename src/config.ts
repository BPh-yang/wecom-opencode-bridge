import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export type BotProvider = "wecom" | "feishu";

interface BaseBridgeConfig {
  botProvider: BotProvider;
  opencodeBaseUrl: string;
  opencodeModelProvider?: string;
  opencodeModelId?: string;
  sessionStorePath: string;
}

interface ProviderAccessConfig {
  allowedUserIds: Set<string>;
}

export interface WeComProviderConfig extends ProviderAccessConfig {
  botId: string;
  botSecret: string;
  welcomeMessage?: string;
}

export interface FeishuProviderConfig extends ProviderAccessConfig {
  appId: string;
  appSecret: string;
}

export interface WeComBridgeConfig extends BaseBridgeConfig {
  botProvider: "wecom";
  wecom: WeComProviderConfig;
}

export interface FeishuBridgeConfig extends BaseBridgeConfig {
  botProvider: "feishu";
  feishu: FeishuProviderConfig;
}

export type BridgeConfig = WeComBridgeConfig | FeishuBridgeConfig;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function splitCsv(value: string | undefined): Set<string> {
  if (!value) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function loadBotProvider(): BotProvider {
  const value = normalizeOptional(process.env.BOT_PROVIDER)?.toLowerCase();
  if (!value) {
    return "wecom";
  }

  if (value === "wecom" || value === "feishu") {
    return value;
  }

  throw new Error(`Unsupported BOT_PROVIDER: ${value}. Expected 'wecom' or 'feishu'.`);
}

function loadAllowedUserIds(provider: BotProvider): Set<string> {
  const shared = normalizeOptional(process.env.BOT_ALLOWED_USER_IDS);
  if (shared) {
    return splitCsv(shared);
  }

  return splitCsv(
    provider === "wecom"
      ? process.env.WECOM_ALLOWED_USER_IDS
      : process.env.FEISHU_ALLOWED_OPEN_IDS,
  );
}

function loadWeComWelcomeMessage(): string | undefined {
  return normalizeOptional(process.env.BOT_WELCOME_MESSAGE)
    ?? normalizeOptional(process.env.WECOM_WELCOME_MESSAGE);
}

export function loadConfig(): BridgeConfig {
  const botProvider = loadBotProvider();
  const modelProvider = normalizeOptional(process.env.OPENCODE_MODEL_PROVIDER);
  const modelId = normalizeOptional(process.env.OPENCODE_MODEL_ID);
  const baseConfig = {
    botProvider,
    opencodeBaseUrl:
      normalizeOptional(process.env.OPENCODE_BASE_URL) ?? "http://127.0.0.1:4096",
    opencodeModelProvider: modelProvider,
    opencodeModelId: modelId,
    sessionStorePath: path.resolve(
      process.cwd(),
      normalizeOptional(process.env.SESSION_STORE_PATH) ?? ".data/sessions.json",
    ),
  };

  if ((modelProvider && !modelId) || (!modelProvider && modelId)) {
    throw new Error(
      "OPENCODE_MODEL_PROVIDER and OPENCODE_MODEL_ID must be set together when overriding the model.",
    );
  }

  if (botProvider === "wecom") {
    return {
      ...baseConfig,
      botProvider: "wecom",
      wecom: {
        botId: requireEnv("WECOM_BOT_ID"),
        botSecret: requireEnv("WECOM_BOT_SECRET"),
        allowedUserIds: loadAllowedUserIds("wecom"),
        welcomeMessage: loadWeComWelcomeMessage(),
      },
    };
  }

  return {
    ...baseConfig,
    botProvider: "feishu",
    feishu: {
      appId: requireEnv("FEISHU_APP_ID"),
      appSecret: requireEnv("FEISHU_APP_SECRET"),
      allowedUserIds: loadAllowedUserIds("feishu"),
    },
  };
}
