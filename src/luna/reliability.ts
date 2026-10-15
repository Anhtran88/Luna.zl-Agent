import { redactAuditDetail, containsSecret } from "./security.ts";

export interface LogEvent {
  level: "info" | "warn" | "error";
  message: string;
  correlationId: string;
  network: false;
  telemetry: false;
}

export function correlationId(sequence: number): string {
  return `corr_${sequence}`;
}

export class LocalLog {
  readonly events: LogEvent[] = [];
  readonly network = false as const;
  readonly telemetry = false as const;

  write(level: LogEvent["level"], message: string, id: string): LogEvent {
    const event: LogEvent = {
      level,
      message: redactAuditDetail(message),
      correlationId: id,
      network: false,
      telemetry: false,
    };
    this.events.push(event);
    return event;
  }
}

export class LocalCircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(threshold: number, cooldownMs: number, now: () => number) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  allow(): boolean {
    if (this.state === "open" && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open";
    }
    return this.state !== "open";
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  snapshot(): { state: "closed" | "open" | "half-open"; network: false } {
    return { state: this.state, network: false };
  }
}

export class IdempotencyStore {
  private readonly done = new Map<string, string>();
  readonly network = false as const;

  begin(key: string): "started" | "replay" {
    return this.done.has(key) ? "replay" : "started";
  }

  complete(key: string, result: string): void {
    this.done.set(key, result);
  }

  result(key: string): string | undefined {
    return this.done.get(key);
  }
}

export function offlineRetry(input: {
  failuresBeforeSuccess: number;
  maxRetries: number;
}): { attempts: number; outcome: "ok" | "timeout"; network: false; estimatedUsd: 0 } {
  const attempts = Math.min(input.maxRetries + 1, input.failuresBeforeSuccess + 1);
  const outcome = input.failuresBeforeSuccess <= input.maxRetries ? "ok" : "timeout";
  return { attempts, outcome, network: false, estimatedUsd: 0 };
}

export function runOfflineSteps(steps: ReadonlyArray<{ id: string; fail?: boolean }>): {
  applied: string[];
  failed: string | null;
  rolledBack: boolean;
  network: false;
} {
  const applied: string[] = [];
  for (const step of steps) {
    if (step.fail) {
      return { applied: [], failed: step.id, rolledBack: true, network: false };
    }
    applied.push(step.id);
  }
  return { applied, failed: null, rolledBack: false, network: false };
}

export class LocalProcess {
  private accepting = true;

  accept(): boolean {
    return this.accepting;
  }

  shutdown(): { accepting: false; drained: true; network: false } {
    this.accepting = false;
    return { accepting: false, drained: true, network: false };
  }
}

export function backupJson(value: unknown):
  | { ok: true; copy: unknown; network: false }
  | { ok: false; network: false; reason: "secret" | "unserializable" } {
  let text = "";
  try {
    text = JSON.stringify(value);
  } catch {
    return { ok: false, network: false, reason: "unserializable" };
  }
  if (text === undefined || containsSecret(text)) return { ok: false, network: false, reason: "secret" };
  return { ok: true, copy: JSON.parse(text) as unknown, network: false };
}

export function restoreJson(backup: { ok: true; copy: unknown } | { ok: false }): unknown {
  if (!backup.ok) throw new Error("Không có bản sao local để khôi phục.");
  return backup.copy;
}

export function localProbes(): {
  liveness: "ok";
  readiness: "local-only";
  production: "NO-GO";
  network: false;
  telemetry: false;
} {
  return {
    liveness: "ok",
    readiness: "local-only",
    production: "NO-GO",
    network: false,
    telemetry: false,
  };
}
