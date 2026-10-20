/**
 * Small in-memory token bucket. Each key (an IP or a participant) gets `capacity`
 * actions that refill at `refillPerSecond`. Good enough for a single-instance app.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private capacity: number,
    private refillPerSecond: number,
    private now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + ((t - bucket.updated) / 1000) * this.refillPerSecond);
    bucket.updated = t;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.prune(t);
    return allowed;
  }

  private prune(t: number) {
    const fullAfterMs = (this.capacity / this.refillPerSecond) * 1000;
    for (const [key, b] of this.buckets) if (t - b.updated > fullAfterMs) this.buckets.delete(key);
  }
}
