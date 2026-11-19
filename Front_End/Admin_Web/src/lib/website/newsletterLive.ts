/**
 * BHA-NEWSLETTER-LIVE-001: the browser end of the Newsletter live signal, with no React in it.
 *
 * The Hub only says "a subscription was just verified"; the list is still read from the REST API. This module keeps ONE connection alive for the screen that asked
 * for it: handlers are registered before `start()`, the first start and every later one are retried with a back-off (the library retries neither a failed first start
 * nor a 401/403), a 401/403 on the negotiate call is handed to the caller and stops the retries (a network failure never is), and `dispose()` removes the handlers,
 * stops the connection and cancels every timer, also when it lands in the middle of a start (React Strict Mode mounts, unmounts and mounts again).
 *
 * Delivery is best effort and covers the one API instance the connection lands on: nothing is replayed. That is why a connection tells the caller when it is READY
 * (the server has registered it), and the caller reads the list again then and after every reconnect instead of trusting that it missed nothing.
 */

export const LIVE_VERIFIED_EVENT = "newsletterVerified";
export const LIVE_READY_EVENT = "newsletterLiveReady";

/** `connecting`: first attempt. `connected`: started. `retrying`: lost or failed, a new attempt is scheduled. `stopped`: 401/403 or no URL; only `retryNow` goes on. */
export type LiveStatus = "connecting" | "connected" | "retrying" | "stopped";
export type LiveStopReason = "unauthenticated" | "denied" | "config";

export interface LiveSignal {
  eventId: string;
  occurredAtUtc: string;
}

/** The part of a SignalR `HubConnection` this module uses, so a test can stand in for the transport. */
export interface LiveConnectionLike {
  on(method: string, handler: (...args: unknown[]) => void): void;
  off(method: string, handler: (...args: unknown[]) => void): void;
  onclose(callback: (error?: Error) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface LiveHandlers {
  /** The server has registered this connection: from now on it receives signals. Called after the first start and after every reconnect. */
  onReady(): void;
  onSignal(signal: LiveSignal): void;
  onStatus(status: LiveStatus, stoppedFor?: LiveStopReason): void;
  /** The negotiate call answered 401: the session is gone. The retries stop. */
  onUnauthenticated(): void;
  /** The negotiate call answered 403: the permission is gone, or the Origin was refused. The retries stop. */
  onDenied(): void;
}

export interface LiveOptions {
  /** The Hub address, or a message when there is none (not Staff mode, no API base URL). */
  target: { ok: true; url: string } | { ok: false; message: string };
  handlers: LiveHandlers;
  factory?: (url: string) => Promise<LiveConnectionLike>;
  /** Milliseconds before the 1st, 2nd, … attempt after a failure; the last one repeats. */
  backoffMs?: readonly number[];
}

export interface LiveController {
  /** Tries now, once, unless an attempt is on its way. Also the way out of `stopped`. */
  retryNow(): void;
  dispose(): void;
}

export const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000] as const;

/** WebSockets only (the server offers nothing else, so there is no long-polling surface to clean up) and credentialed: the Staff cookie is the credential. */
export async function createHubConnection(url: string): Promise<LiveConnectionLike> {
  const { HttpTransportType, HubConnectionBuilder, LogLevel } = await import("@microsoft/signalr");
  return new HubConnectionBuilder().withUrl(url, { transport: HttpTransportType.WebSockets, withCredentials: true }).configureLogging(LogLevel.None).build();
}

const isSignal = (value: unknown): value is LiveSignal =>
  typeof value === "object" && value !== null && typeof (value as LiveSignal).eventId === "string" && (value as LiveSignal).eventId !== "";

const statusOf = (error: unknown): number | null => {
  const code = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === "number" ? code : null;
};

export function startNewsletterLive(options: LiveOptions): LiveController {
  const { handlers } = options;
  const factory = options.factory ?? createHubConnection;
  const backoff = options.backoffMs && options.backoffMs.length > 0 ? options.backoffMs : DEFAULT_BACKOFF_MS;
  let disposed = false;
  let attempting = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: { connection: LiveConnectionLike; detach: () => void } | null = null;
  let everConnected = false;

  const stopQuietly = (connection: LiveConnectionLike) => {
    try {
      void connection.stop().catch(() => undefined);
    } catch {
      // A connection that throws while stopping has nothing left to stop.
    }
  };

  const release = () => {
    if (!current) return;
    const { connection, detach } = current;
    current = null;
    detach();
    stopQuietly(connection);
  };

  const scheduleRetry = () => {
    if (disposed) return;
    handlers.onStatus("retrying");
    const delay = backoff[Math.min(attempts, backoff.length - 1)];
    attempts += 1;
    timer = setTimeout(() => {
      timer = null;
      void attempt();
    }, delay);
  };

  const attempt = async (): Promise<void> => {
    if (disposed || attempting) return;
    attempting = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!options.target.ok) {
      attempting = false;
      handlers.onStatus("stopped", "config");
      return;
    }

    handlers.onStatus(everConnected ? "retrying" : "connecting");
    let connection: LiveConnectionLike;
    try {
      connection = await factory(options.target.url);
    } catch {
      attempting = false;
      scheduleRetry();
      return;
    }

    const onSignal = (...args: unknown[]) => {
      if (isSignal(args[0])) handlers.onSignal({ eventId: args[0].eventId, occurredAtUtc: String(args[0].occurredAtUtc ?? "") });
    };
    const onReady = () => handlers.onReady();
    // Handlers first, then the start: nothing the server sends right after the handshake can arrive before something listens.
    connection.on(LIVE_VERIFIED_EVENT, onSignal);
    connection.on(LIVE_READY_EVENT, onReady);
    const mine = {
      connection,
      detach: () => {
        connection.off(LIVE_VERIFIED_EVENT, onSignal);
        connection.off(LIVE_READY_EVENT, onReady);
      },
    };
    current = mine;
    connection.onclose(() => {
      if (disposed || current !== mine) return;
      release();
      attempts = 0;
      scheduleRetry();
    });

    if (disposed) {
      release();
      attempting = false;
      return;
    }

    try {
      await connection.start();
    } catch (error) {
      attempting = false;
      if (current === mine) release();
      if (disposed) return;
      const status = statusOf(error);
      if (status === 401) {
        handlers.onStatus("stopped", "unauthenticated");
        handlers.onUnauthenticated();
      } else if (status === 403) {
        handlers.onStatus("stopped", "denied");
        handlers.onDenied();
      } else {
        scheduleRetry();                                    // a network failure is never a sign-out
      }
      return;
    }

    attempting = false;
    if (disposed || current !== mine) {
      if (current === mine) release();
      else stopQuietly(connection);
      return;
    }

    attempts = 0;
    everConnected = true;
    handlers.onStatus("connected");
  };

  void attempt();

  return {
    retryNow() {
      if (disposed || attempting) return;
      attempts = 0;
      void attempt();
    },
    dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      release();
    },
  };
}
