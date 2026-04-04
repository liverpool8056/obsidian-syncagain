import { ApiClient } from "./api-client";
import type { ServerConfig } from "./api-client";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

type RemoteChangeHandler = (event: { event: "file_changed" | "file_deleted"; key: string }) => void;
type ConnectionStatusHandler = (status: ConnectionStatus) => void;
type ConfigHandler = (config: ServerConfig) => void;

interface PingMessage {
  type: "ping";
  seq: number;
  last_config_version: number;
}

interface PongMessage {
  type: "pong";
  seq: number;
  config_version: number;
  config?: ServerConfig;
}

interface FileEventMessage {
  type: "file_changed" | "file_deleted";
  path: string;
  client_id: string;
}

type ServerMessage = PongMessage | FileEventMessage;

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2;

/**
 * Persistent WebSocket control channel to the sync server.
 *
 * Replaces the SSE EventListener. Provides bidirectional flow:
 * - plugin → server: ping (with last_config_version for config delivery)
 * - server → plugin: pong (with optional inline config when version advances)
 * - server → plugin: file_changed / file_deleted events
 *
 * Offline is detected when no pong is received within 2 × ping_interval.
 * Reconnects with exponential backoff. On reconnect, sends last_config_version: 0
 * to force a full config delivery in the first pong.
 */
export class ControlChannel {
  private ws: WebSocket | null = null;
  private stopped = false;
  private retryMs = 1_000;
  private readonly maxRetryMs = 30_000;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private lastConfigVersion = 0;

  constructor(
    private readonly api: ApiClient,
    private readonly ownClientId: string,
    private readonly onRemoteChange: RemoteChangeHandler,
    private readonly onConfig: ConfigHandler,
    private readonly onConnectionStatus?: ConnectionStatusHandler,
  ) {}

  start(): void {
    this.stopped = false;
    // Tear down any existing connection and pending timers before opening a
    // new one. This makes start() safe to call repeatedly (e.g. when the
    // server URL changes mid-session).
    this.clearAllTimers();
    this.closeWs();
    this.onConnectionStatus?.("connecting");
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearAllTimers();
    this.closeWs();
    this.onConnectionStatus?.("disconnected");
  }

  private connect(): void {
    if (this.stopped) return;

    const url = this.api.buildWsUrl();
    if (!url) {
      this.onConnectionStatus?.("disconnected");
      return;
    }

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.retryMs = 1_000;
        this.onConnectionStatus?.("connected");
        // Send last_config_version: 0 on every (re)connect to force full config delivery.
        this.sendPing(0);
        this.startPingLoop();
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          this.handleMessage(msg);
        } catch {
          // Malformed message — ignore.
        }
      };

      ws.onerror = () => {
        this.onConnectionStatus?.("connecting");
      };

      ws.onclose = () => {
        this.ws = null;
        this.clearPingLoop();
        if (!this.stopped) {
          this.onConnectionStatus?.("connecting");
          this.scheduleReconnect();
        }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: ServerMessage): void {
    if (msg.type === "pong") {
      this.clearPongTimeout();
      this.lastConfigVersion = msg.config_version;
      if (msg.config) {
        this.onConfig(msg.config);
      }
    } else if (msg.type === "file_changed" || msg.type === "file_deleted") {
      if (msg.client_id === this.ownClientId) return;
      this.onRemoteChange({ event: msg.type, key: msg.path });
    }
  }

  private sendPing(overrideConfigVersion?: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const ping: PingMessage = {
      type: "ping",
      seq: ++this.seq,
      last_config_version: overrideConfigVersion ?? this.lastConfigVersion,
    };
    this.ws.send(JSON.stringify(ping));

    // Arm pong timeout: close and reconnect if server is unresponsive.
    this.clearPongTimeout();
    this.pongTimeout = setTimeout(() => {
      this.onConnectionStatus?.("disconnected");
      this.closeWs(); // triggers ws.onclose → scheduleReconnect
    }, PONG_TIMEOUT_MS);
  }

  private startPingLoop(): void {
    this.clearPingLoop();
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, PING_INTERVAL_MS);
  }

  private clearPingLoop(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.clearPongTimeout();
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout !== null) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private clearAllTimers(): void {
    this.clearPingLoop();
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.retryTimeout = setTimeout(() => {
      this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
  }

  private closeWs(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
