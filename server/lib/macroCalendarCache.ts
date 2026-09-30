// A failed/empty upstream scrape must not poison a good cache or masquerade as
// a successfully loaded (empty) calendar. Concurrent readers share one scrape.
export class MacroCalendarCache<T> {
  private data: T[] = [];
  private timestamp = 0;
  private lastAttempt = 0;
  private hasSnapshot = false;
  private stale = false;
  private inFlight: Promise<T[]> | null = null;

  get snapshot(): T[] { return this.data; }

  constructor(
    private readonly fetchEvents: () => Promise<T[]>,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(force = false): Promise<{ events: T[]; stale: boolean; fetchedAt: number }> {
    // Even a manual retry must respect a short failure cooldown. A single
    // unreleased/past event never bypasses the cache TTL.
    if (!this.inFlight && this.hasSnapshot && this.now() - this.lastAttempt < (force ? 30_000 : this.ttlMs)) {
      return { events: this.data, stale: this.stale, fetchedAt: this.timestamp };
    }
    if (!this.inFlight) {
      this.inFlight = (async () => {
        this.lastAttempt = this.now();
        try {
          const fetched = await this.fetchEvents();
          if (!Array.isArray(fetched)) throw new Error("Invalid macro calendar response");
          this.data = fetched;
          this.timestamp = this.now();
          this.hasSnapshot = true;
          this.stale = false;
          return fetched;
        } catch (error) {
          if (this.hasSnapshot) { this.stale = true; return this.data; }
          throw error;
        }
      })().finally(() => { this.inFlight = null; });
    }
    const events = await this.inFlight;
    return { events, stale: this.stale, fetchedAt: this.timestamp };
  }
}