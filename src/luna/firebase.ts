import { LunaError, PhaseLockedError, randomIds, type Ids } from "./domain.ts";
import type { FirebasePublicConfig } from "./config.ts";
import type { FirebaseConnectInput } from "./firebase-rtdb.ts";

export interface RealtimeDatabase {
  readonly id: string;
  readonly mode: "memory" | "disabled-live" | "rest";
  get<T>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  push(path: string, value: unknown): Promise<string>;
  update(path: string, value: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  listen(path: string, onValue: (value: unknown) => void): () => void;
}

const PATH_RE = /^\/[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/;

export function assertFirebasePath(path: string): void {
  if (!PATH_RE.test(path) || path.length > 256) {
    throw new LunaError("PATH", "Đường dẫn Firebase không hợp lệ.");
  }
}

function cloneJson<T>(value: T): T {
  if (value === undefined) {
    throw new LunaError("DATA", "Giá trị Firebase không được là undefined.");
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new LunaError("DATA", "Giá trị Firebase phải là JSON.");
  }
}

export class MemoryRealtimeDatabase implements RealtimeDatabase {
  readonly id = "firebase-memory";
  readonly mode = "memory" as const;
  private readonly records = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>();
  private readonly ids: Ids;

  constructor(seed?: Record<string, unknown>, ids: Ids = randomIds()) {
    this.ids = ids;
    if (seed) {
      for (const [path, value] of Object.entries(seed)) {
        assertFirebasePath(path);
        this.records.set(path, cloneJson(value));
      }
    }
  }

  async get<T>(path: string): Promise<T | null> {
    assertFirebasePath(path);
    return this.read<T>(path);
  }

  async set(path: string, value: unknown): Promise<void> {
    assertFirebasePath(path);
    this.records.set(path, cloneJson(value));
    this.emit(path);
  }

  async push(path: string, value: unknown): Promise<string> {
    assertFirebasePath(path);
    const id = this.ids.next("node");
    await this.set(`${path}/${id}`, value);
    return id;
  }

  async update(path: string, value: Record<string, unknown>): Promise<void> {
    assertFirebasePath(path);
    const current = this.read<unknown>(path);
    const base =
      current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : null;
    if (current !== null && base === null) {
      throw new LunaError("DATA", "update chỉ áp dụng cho object JSON.");
    }
    await this.set(path, { ...(base ?? {}), ...cloneJson(value) });
  }

  async remove(path: string): Promise<void> {
    assertFirebasePath(path);
    for (const key of [...this.records.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.records.delete(key);
    }
    this.emit(path);
  }

  listen(path: string, onValue: (value: unknown) => void): () => void {
    assertFirebasePath(path);
    const set = this.listeners.get(path) ?? new Set();
    set.add(onValue);
    this.listeners.set(path, set);
    onValue(this.read(path));
    return () => set.delete(onValue);
  }

  private read<T>(path: string): T | null {
    if (!this.records.has(path)) return null;
    return cloneJson(this.records.get(path)) as T;
  }

  private emit(path: string): void {
    for (const [key, set] of this.listeners) {
      const affected = key === path || path.startsWith(`${key}/`) || key.startsWith(`${path}/`);
      if (!affected) continue;
      const value = this.read(key);
      for (const listener of set) listener(value);
    }
  }
}

const LIVE_LOCK_MESSAGE =
  "Firebase live bị khóa ở Phase 0/1. Không kết nối mạng và không đọc credential.";

export class PhaseLockedFirebaseAdapter implements RealtimeDatabase {
  readonly id = "firebase-phase-locked";
  readonly mode = "disabled-live" as const;

  async get<T>(_path: string): Promise<T | null> {
    throw new PhaseLockedError(LIVE_LOCK_MESSAGE);
  }

  async set(_path: string, _value: unknown): Promise<void> {
    throw new PhaseLockedError(LIVE_LOCK_MESSAGE);
  }

  async push(_path: string, _value: unknown): Promise<string> {
    throw new PhaseLockedError(LIVE_LOCK_MESSAGE);
  }

  async update(_path: string, _value: Record<string, unknown>): Promise<void> {
    throw new PhaseLockedError(LIVE_LOCK_MESSAGE);
  }

  async remove(_path: string): Promise<void> {
    throw new PhaseLockedError(LIVE_LOCK_MESSAGE);
  }

  listen(_path: string, _onValue: (value: unknown) => void): () => void {
    throw new PhaseLockedError(LIVE_LOCK_MESSAGE);
  }
}

/**
 * Phase 0/1 factory. A live request does not construct a network client;
 * it returns an adapter whose every call fails closed.
 */
export function createRealtimeDatabase(
  config: FirebasePublicConfig,
  seed?: Record<string, unknown>,
  _connect?: FirebaseConnectInput,
): RealtimeDatabase {
  if (!config.liveRequested) return new MemoryRealtimeDatabase(seed);
  return new PhaseLockedFirebaseAdapter();
}
