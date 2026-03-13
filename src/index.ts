import type { BotBridge } from "./bot-bridge.js";
import { type BridgeConfig, loadConfig } from "./config.js";
import { FeishuBridge } from "./feishu.js";
import { OpencodeBridge } from "./opencode.js";
import { SessionStore } from "./session-store.js";
import { WeComBridge } from "./wecom.js";

function createBotBridge(config: BridgeConfig, opencodeBridge: OpencodeBridge): BotBridge {
  if (config.botProvider === "wecom") {
    return new WeComBridge(config, opencodeBridge);
  }

  return new FeishuBridge(config, opencodeBridge);
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`[System] Starting bridge with provider: ${config.botProvider}`);

  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.load();

  const opencodeBridge = new OpencodeBridge(config, sessionStore);
  console.log(`[OpenCode] Checking ${config.opencodeBaseUrl} ...`);
  await opencodeBridge.healthCheck();
  console.log(`[OpenCode] Connected to ${config.opencodeBaseUrl}`);

  const botBridge = createBotBridge(config, opencodeBridge);
  await botBridge.start();

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`[System] Received ${signal}, shutting down...`);

    try {
      await botBridge.stop();
      process.exit(0);
    } catch (error) {
      console.error("[System] Failed to stop bridge cleanly:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  console.error("[System] Bridge failed to start:", error);
  process.exit(1);
});
