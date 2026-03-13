import { loadConfig } from "./config.js";
import { OpencodeBridge } from "./opencode.js";
import { SessionStore } from "./session-store.js";
import { WeComBridge } from "./wecom.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.load();

  const opencodeBridge = new OpencodeBridge(config, sessionStore);
  await opencodeBridge.healthCheck();
  console.log(`[OpenCode] Connected to ${config.opencodeBaseUrl}`);

  const wecomBridge = new WeComBridge(config, opencodeBridge);
  wecomBridge.start();

  const shutdown = (signal: string) => {
    console.log(`[System] Received ${signal}, shutting down...`);
    wecomBridge.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[System] Bridge failed to start:", error);
  process.exit(1);
});
