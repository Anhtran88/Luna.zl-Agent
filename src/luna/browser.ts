import { PhaseLockedError } from "./domain.ts";

export const BROWSER_BACKENDS = ["mock", "playwright", "skyvern", "browser-use"] as const;
export type BrowserBackendId = (typeof BROWSER_BACKENDS)[number];

export const BROWSER_CAPABILITIES = [
  "navigate",
  "snapshot",
  "click",
  "type",
  "extract",
  "login",
  "upload",
  "download",
] as const;
export type BrowserCapability = (typeof BROWSER_CAPABILITIES)[number];

export const SENSITIVE_BROWSER_CAPABILITIES = new Set<BrowserCapability>([
  "login",
  "upload",
  "download",
]);

export interface BrowserCommand {
  capability: BrowserCapability;
  requestedAdapter?: BrowserBackendId;
  target?: string;
}

export interface BrowserCommandResult {
  adapterId: BrowserBackendId;
  requestedAdapter: BrowserBackendId;
  rerouted: boolean;
  outcome: "simulated" | "refused";
  summary: string;
}

export interface BrowserAdapter {
  readonly id: BrowserBackendId;
  readonly readiness: "ready" | "stub";
  readonly capabilities: readonly BrowserCapability[];
  execute(command: BrowserCommand): Promise<BrowserCommandResult>;
}

export interface BrowserSelection {
  adapterId: "mock";
  requestedAdapter: BrowserBackendId;
  rerouted: boolean;
}

/** Phase 0/1 policy: every backend request is forced onto the mock adapter. */
export function chooseBrowserAdapter(requested?: BrowserBackendId): BrowserSelection {
  const requestedAdapter = requested ?? "mock";
  return {
    adapterId: "mock",
    requestedAdapter,
    rerouted: requestedAdapter !== "mock",
  };
}

function summarize(command: BrowserCommand, selection: BrowserSelection): BrowserCommandResult {
  const target = command.target?.trim() ? ` Mục tiêu ghi nhận: ${command.target.trim()}.` : "";
  const reroute = selection.rerouted
    ? ` Yêu cầu ${selection.requestedAdapter} được chuyển sang mock.`
    : "";

  if (SENSITIVE_BROWSER_CAPABILITIES.has(command.capability)) {
    return {
      adapterId: "mock",
      requestedAdapter: selection.requestedAdapter,
      rerouted: selection.rerouted,
      outcome: "refused",
      summary: `Từ chối ${command.capability}: không đăng nhập, không upload và không download.${reroute}${target}`,
    };
  }

  return {
    adapterId: "mock",
    requestedAdapter: selection.requestedAdapter,
    rerouted: selection.rerouted,
    outcome: "simulated",
    summary: `Dry-run ${command.capability}. Không mở trình duyệt thật.${reroute}${target}`,
  };
}

export class MockBrowserAdapter implements BrowserAdapter {
  readonly id = "mock" as const;
  readonly readiness = "ready" as const;
  readonly capabilities = BROWSER_CAPABILITIES;

  async execute(command: BrowserCommand): Promise<BrowserCommandResult> {
    return summarize(command, chooseBrowserAdapter("mock"));
  }
}

export function createStubBrowserAdapter(id: Exclude<BrowserBackendId, "mock">): BrowserAdapter {
  return {
    id,
    readiness: "stub",
    capabilities: BROWSER_CAPABILITIES,
    async execute() {
      throw new PhaseLockedError(
        `Adapter ${id} chỉ là stub ở Phase 0/1. Không khởi chạy trình duyệt và không đăng nhập.`,
      );
    },
  };
}

export class BrowserOrchestrator {
  private readonly adapters = new Map<BrowserBackendId, BrowserAdapter>();

  constructor(adapters?: BrowserAdapter[]) {
    const all = adapters ?? [
      new MockBrowserAdapter(),
      createStubBrowserAdapter("playwright"),
      createStubBrowserAdapter("skyvern"),
      createStubBrowserAdapter("browser-use"),
    ];
    for (const adapter of all) this.adapters.set(adapter.id, adapter);
  }

  registered(): BrowserBackendId[] {
    return [...this.adapters.keys()];
  }

  /**
   * Runs only the mock adapter. Stub `execute` is never called, even when the
   * caller names Playwright, Skyvern or Browser Use.
   */
  async run(command: BrowserCommand): Promise<BrowserCommandResult> {
    const selection = chooseBrowserAdapter(command.requestedAdapter);
    const mock = this.adapters.get("mock");
    if (!mock) throw new PhaseLockedError("Thiếu mock browser adapter.");
    if (!SENSITIVE_BROWSER_CAPABILITIES.has(command.capability)) {
      await mock.execute({ ...command, requestedAdapter: "mock" });
    }
    return summarize(command, selection);
  }
}

export function createBrowserOrchestrator(): BrowserOrchestrator {
  return new BrowserOrchestrator();
}
