import fs from "node:fs/promises";
import path from "node:path";

interface SessionStoreData {
  conversationToSession: Record<string, string>;
}

const EMPTY_STORE: SessionStoreData = {
  conversationToSession: {},
};

export class SessionStore {
  private data: SessionStoreData = EMPTY_STORE;

  public constructor(private readonly filePath: string) {}

  public async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionStoreData>;
      this.data = {
        conversationToSession: parsed.conversationToSession ?? {},
      };
    } catch (error) {
      const isMissingFile =
        error instanceof Error && "code" in error && error.code === "ENOENT";
      if (isMissingFile) {
        this.data = {
          conversationToSession: {},
        };
        return;
      }
      throw error;
    }
  }

  public getSessionId(conversationKey: string): string | undefined {
    return this.data.conversationToSession[conversationKey];
  }

  public async setSessionId(conversationKey: string, sessionId: string): Promise<void> {
    this.data.conversationToSession[conversationKey] = sessionId;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempFilePath = `${this.filePath}.tmp`;
    await fs.writeFile(tempFilePath, JSON.stringify(this.data, null, 2), "utf8");
    await fs.rename(tempFilePath, this.filePath);
  }
}
