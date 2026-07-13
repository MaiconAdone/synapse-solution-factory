export interface VickLocalEvent {
  id: number;
  transcript: string;
  command: string;
  source: "faster_whisper_local";
}

export class VickLocalServiceClient {
  private timer?: NodeJS.Timeout;
  private lastEventId = 0;
  private polling = false;

  public constructor(
    private baseUrl: string,
    private readonly onCommand: (event: VickLocalEvent) => Promise<void>
  ) {}

  public configure(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  public async start(): Promise<{ engineReady: boolean; error?: string | null }> {
    const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Vick local service HTTP ${response.status}`);
    const health = await response.json() as { engineReady: boolean; error?: string | null };
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 700);
    return health;
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const response = await fetch(`${this.baseUrl}/events?after=${this.lastEventId}`, {
        signal: AbortSignal.timeout(2500)
      });
      if (!response.ok) return;
      const payload = await response.json() as { events?: VickLocalEvent[] };
      for (const event of payload.events ?? []) {
        this.lastEventId = Math.max(this.lastEventId, event.id);
        await this.onCommand(event);
      }
    } catch {
      // A proxima sondagem recupera falhas transitorias do servico local.
    } finally {
      this.polling = false;
    }
  }
}
