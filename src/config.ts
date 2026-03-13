import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export interface BridgeConfig {
  wecomBotId: string;
  wecomBotSecret: string;
  opencodeBaseUrl: string;
  opencodeModelProvider?: string;
  opencodeModelId?: string;
  allowedUserIds: Set<string>;
  welcomeMessage?: string;
  sessionStorePath: string;
}

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

export function loadConfig(): BridgeConfig {
  const modelProvider = normalizeOptional(process.env.OPENCODE_MODEL_PROVIDER);
  const modelId = normalizeOptional(process.env.OPENCODE_MODEL_ID);

  if ((modelProvider && !modelId) || (!modelProvider && modelId)) {
    throw new Error(
      "OPENCODE_MODEL_PROVIDER and OPENCODE_MODEL_ID must be set together when overriding the model.",
    );
  }

  return {
    wecomBotId: requireEnv("WECOM_BOT_ID"),
    wecomBotSecret: requireEnv("WECOM_BOT_SECRET"),
    opencodeBaseUrl:
      normalizeOptional(process.env.OPENCODE_BASE_URL) ?? "http://127.0.0.1:4096",
    opencodeModelProvider: modelProvider,
    opencodeModelId: modelId,
    allowedUserIds: splitCsv(process.env.WECOM_ALLOWED_USER_IDS),
    welcomeMessage: normalizeOptional(process.env.WECOM_WELCOME_MESSAGE),
    sessionStorePath: path.resolve(
      process.cwd(),
      normalizeOptional(process.env.SESSION_STORE_PATH) ?? ".data/sessions.json",
    ),
  };
}
