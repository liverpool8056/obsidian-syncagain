import { ApiClient } from "./api-client";

export type SyncEventType =
  | "file_changed"
  | "file_deleted"
  | "lock_acquired"
  | "lock_released";

export interface SyncEvent {
  event: SyncEventType;
  key: string | null;
  client_id: string | null;
}

type EventHandler = (event: SyncEvent) => void;

/**
 * Manages a persistent SSE connection to the sync server.
 *
 * Reconnects automatically with exponential backoff on failure.
 * Events emitted by OTHER clients trigger immediate sync callbacks so that
 * this client downloads changes without waiting for the next scheduled cycle.
 */
export class EventListener {
  private es: EventSource | null = null;
  private retryMs = 1_000;
  private readonly maxRetryMs = 30_000;
  private stopped = false;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly ownClientId: string,
    private readonly onRemoteChange: EventHandler,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    this.closeSource();
  }

  private connect(): void {
    if (this.stopped) return;

    try {
      const url = this.api.buildEventsUrl();
      if (!url) {
        // Not signed in — don't attempt to connect.
        return;
      }
      const es = new EventSource(url);
      this.es = es;

      es.onopen = () => {
        this.retryMs = 1_000; // reset backoff on successful connection
      };

      es.onerror = () => {
        es.close();
        this.es = null;
        this.scheduleReconnect();
      };

      // Handle all named event types from the server.
      const handleEvent = (raw: MessageEvent) => {
        try {
          const payload = JSON.parse(raw.data) as SyncEvent;
          // Ignore events we ourselves triggered.
          if (payload.client_id === this.ownClientId) return;
          if (
            payload.event === "file_changed" ||
            payload.event === "file_deleted"
          ) {
            this.onRemoteChange(payload);
          }
        } catch {
          // Malformed event — ignore.
        }
      };

      es.addEventListener("file_changed", handleEvent);
      es.addEventListener("file_deleted", handleEvent);
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.retryTimeout = setTimeout(() => {
      this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
  }

  private closeSource(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }
}
