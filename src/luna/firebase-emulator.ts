import { LunaError } from "./domain.ts";
import { FirebaseRtdbClient, type RtdbTransport, type RtdbTransportRequest, type RtdbTransportResponse } from "./firebase-rtdb.ts";
import { MemoryRealtimeDatabase } from "./firebase.ts";

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/**
 * REST-shaped transport backed by process memory. It refuses any host that is
 * not loopback, so the production database URL cannot be reached through it.
 */
export class InProcessRtdbTransport implements RtdbTransport {
  private readonly db: MemoryRealtimeDatabase;

  constructor(db = new MemoryRealtimeDatabase()) {
    this.db = db;
  }

  async request(input: RtdbTransportRequest): Promise<RtdbTransportResponse> {
    const url = new URL(input.url);
    if (url.protocol !== "http:" || !isLoopback(url.hostname)) {
      throw new LunaError("NETWORK", "Transport emulator chỉ nhận http trên loopback.");
    }
    const path = decodeURIComponent(url.pathname.replace(/\.json$/, "")) || "/";
    if (input.method === "GET") return { status: 200, body: await this.db.get(path) };
    if (input.method === "PUT") {
      await this.db.set(path, input.body);
      return { status: 200, body: input.body ?? null };
    }
    if (input.method === "PATCH") {
      const value =
        input.body && typeof input.body === "object" && !Array.isArray(input.body)
          ? (input.body as Record<string, unknown>)
          : {};
      await this.db.update(path, value);
      return { status: 200, body: input.body ?? null };
    }
    if (input.method === "POST") {
      const name = await this.db.push(path, input.body);
      return { status: 200, body: { name } };
    }
    if (input.method === "DELETE") {
      await this.db.remove(path);
      return { status: 200, body: null };
    }
    throw new LunaError("NETWORK", "Method emulator không được hỗ trợ.");
  }
}

export function createInProcessEmulatorClient(): FirebaseRtdbClient {
  return new FirebaseRtdbClient({
    databaseUrl: "http://127.0.0.1:9000",
    authToken: "emulator-local",
    transport: new InProcessRtdbTransport(),
  });
}
