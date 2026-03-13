export class ConversationQueue {
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
