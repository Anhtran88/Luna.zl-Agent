import type { FirebasePublicConfig } from "./config.ts";
import { LunaError } from "./domain.ts";
import { assertFirebasePath, type RealtimeDatabase } from "./firebase.ts";

export interface RtdbTransportResponse {
  status: number;
  body: unknown;
}

export interface RtdbTransportRequest {
  method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  url: string;
  body?: unknown;
}

/** Injected HTTP port. The app factory never supplies the global fetch. */
export interface RtdbTransport {
  request(input: RtdbTransportRequest): Promise<RtdbTransportResponse>;
}

export interface FirebaseConnectInput {
  transport?: RtdbTransport;
  authToken?: string;
}

const FIREBASE_HOST = /^[a-z0-9-]+\.(firebasedatabase\.app|firebaseio\.com)$/i;

export type FirebaseConnectDecision =
  | { ok: false; reason: string }
  | { ok: true; databaseUrl: string; authToken: string; transport: RtdbTransport };

/**
 * Live REST is reachable only when the caller passes both an official database
 * URL and an in-memory token plus a transport. Service-account JSON is not a
 * REST token and is rejected. Missing any piece stays locked and does not call
 * the transport.
 */
export function evaluateFirebaseConnect(
  config: FirebasePublicConfig,
  connect?: FirebaseConnectInput,
): FirebaseConnectDecision {
  if (!config.liveRequested) return { ok: false, reason: "live-not-requested" };
  if (!config.databaseUrl || !config.databaseUrlHost) {
    return { ok: false, reason: "missing-database-url" };
  }
  if (!FIREBASE_HOST.test(config.databaseUrlHost)) {
    return { ok: false, reason: "host-not-firebase" };
  }
  if (!connect?.transport) return { ok: false, reason: "missing-transport" };
  const token = connect.authToken?.trim() ?? "";
  if (!token) return { ok: false, reason: "missing-auth-token" };
  if (token.startsWith("{") || token.includes("PRIVATE")) {
    return { ok: false, reason: "service-account-is-not-a-rest-token" };
  }
  return {
    ok: true,
    databaseUrl: config.databaseUrl,
    authToken: token,
    transport: connect.transport,
  };
}

function redact(message: string, token: string): string {
  return message.split(token).join("[redacted]");
}

export class FirebaseRtdbClient implements RealtimeDatabase {
  readonly id = "firebase-rtdb-rest";
  readonly mode = "rest" as const;
  private readonly databaseUrl: string;
  private readonly authToken: string;
  private readonly transport: RtdbTransport;

  constructor(input: { databaseUrl: string; authToken: string; transport: RtdbTransport }) {
    this.databaseUrl = input.databaseUrl.replace(/\/$/, "");
    this.authToken = input.authToken;
    this.transport = input.transport;
  }

  async get<T>(path: string): Promise<T | null> {
    const body = await this.call("GET", path);
    return (body ?? null) as T | null;
  }

  async set(path: string, value: unknown): Promise<void> {
    await this.call("PUT", path, value);
  }

  async push(path: string, value: unknown): Promise<string> {
    const body = await this.call("POST", path, value);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new LunaError("DATA", "Firebase REST không trả id cho push.");
    }
    const name = (body as { name?: unknown }).name;
    if (typeof name !== "string" || !name) {
      throw new LunaError("DATA", "Firebase REST không trả id cho push.");
    }
    return name;
  }

  async update(path: string, value: Record<string, unknown>): Promise<void> {
    await this.call("PATCH", path, value);
  }

  async remove(path: string): Promise<void> {
    await this.call("DELETE", path);
  }

  /**
   * One REST read, then a no-op unsubscribe. This client does not open a
   * streaming socket or poll.
   */
  listen(path: string, onValue: (value: unknown) => void): () => void {
    assertFirebasePath(path);
    void this.get(path).then(onValue, () => undefined);
    return () => undefined;
  }

  private async call(method: RtdbTransportRequest["method"], path: string, body?: unknown): Promise<unknown> {
    assertFirebasePath(path);
    const url = new URL(`${this.databaseUrl}${path}.json`);
    url.searchParams.set("auth", this.authToken);
    let response: RtdbTransportResponse;
    try {
      response = await this.transport.request({ method, url: url.toString(), body });
    } catch (error) {
      const message = error instanceof Error ? error.message : "transport";
      throw new LunaError("NETWORK", redact(`Firebase REST không gọi được. ${message}`, this.authToken));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new LunaError(
        "NETWORK",
        redact(`Firebase REST trả ${response.status} cho ${method} ${path}.`, this.authToken),
      );
    }
    return response.body;
  }
}
