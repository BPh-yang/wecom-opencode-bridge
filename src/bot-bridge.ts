export interface BotBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
}
