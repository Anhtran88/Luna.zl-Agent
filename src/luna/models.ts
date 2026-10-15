import { LunaError, PhaseLockedError } from "./domain.ts";
import type { NineRouterPublicConfig } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCompletionRequest {
  model: string;
  messages: ChatMessage[];
  /** Local fault injection. Never leaves the process. */
  mockFault?: "timeout" | "unavailable";
}

export interface ModelInfo {
  id: string;
  providerId: "mock" | "nine-router";
  description: string;
}

export interface UsageMetadata {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: 0;
  billed: false;
}

export interface ModelCompletion {
  providerId: "mock" | "nine-router";
  model: string;
  content: string;
  dryRun: true;
  network: false;
  notes: string[];
  usage: UsageMetadata;
}

export interface ModelProvider {
  readonly id: string;
  readonly kind: "mock" | "local" | "nine-router";
  listModels(): Promise<ModelInfo[]>;
  complete(request: ModelCompletionRequest): Promise<ModelCompletion>;
}

export interface ResolvedModelRoute {
  providerId: "mock";
  resolvedModel: string;
  notes: string[];
}

export function resolveModelRoute(
  model: string,
  config: NineRouterPublicConfig,
): ResolvedModelRoute {
  const notes: string[] = [];
  const alias = config.aliases[model];
  const combo = config.combos[model] ?? (alias ? config.combos[alias] : undefined);
  let resolved = alias ?? model;

  if (combo && combo.length > 0) {
    notes.push(`combo:${model}:${combo.join("|")}`);
    resolved = combo[0] ?? resolved;
  } else if (alias) {
    notes.push(`alias:${model}->${alias}`);
  }

  if (!resolved.startsWith("mock/")) {
    notes.push("reroute:nine-router->mock");
    resolved = "mock/luna-planner";
  }

  notes.push("provider:mock");
  notes.push("network:blocked");
  return { providerId: "mock", resolvedModel: resolved, notes };
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function usageFor(request: ModelCompletionRequest, content: string): UsageMetadata {
  const inputTokens = request.messages.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );
  return {
    inputTokens,
    outputTokens: estimateTokens(content),
    estimatedCostUsd: 0,
    billed: false,
  };
}

export class ModelAttemptError extends LunaError {
  readonly attempts: number;
  readonly network = false as const;
  readonly estimatedCostUsd = 0 as const;

  constructor(code: "TIMEOUT" | "UNAVAILABLE", message: string, attempts: number) {
    super(code, message);
    this.name = "ModelAttemptError";
    this.attempts = attempts;
  }
}

export class MockModelProvider implements ModelProvider {
  readonly id = "mock";
  readonly kind = "mock" as const;

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "mock/luna-planner",
        providerId: "mock",
        description: "Planner mock cục bộ, không gọi mạng.",
      },
      {
        id: "mock/luna-planner-fallback",
        providerId: "mock",
        description: "Fallback mock cho combo luna-resilient.",
      },
    ];
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletion> {
    const content = `Mock ${request.model} không gọi mạng. Số tin nhắn: ${request.messages.length}.`;
    return {
      providerId: "mock",
      model: request.model,
      content,
      dryRun: true,
      network: false,
      notes: ["provider:mock", "network:blocked"],
      usage: usageFor(request, content),
    };
  }
}

/**
 * 9Router-shaped provider. `complete` fails closed before `fetchImpl` so a
 * configured key cannot be sent anywhere in Phase 0/1.
 */
export class NineRouterProvider implements ModelProvider {
  readonly id = "nine-router";
  readonly kind = "nine-router" as const;
  private readonly config: NineRouterPublicConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: NineRouterPublicConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "nine-router/catalog-locked",
        providerId: "nine-router",
        description: `Catalog tĩnh. Base ${this.config.baseUrl} không được gọi ở Phase 0/1.`,
      },
    ];
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletion> {
    void request;
    void this.fetchImpl;
    throw new PhaseLockedError(
      "9Router live bị khóa ở Phase 0/1. Không gọi /v1/chat/completions và không gửi API key.",
    );
  }
}

export class ModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  require(id: string): ModelProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new PhaseLockedError(`Không có provider ${id}.`);
    return provider;
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }
}

export class ModelRouter {
  private readonly mock = new MockModelProvider();
  private readonly locked: NineRouterProvider;
  private readonly config: NineRouterPublicConfig;
  readonly registry = new ModelProviderRegistry();

  constructor(config: NineRouterPublicConfig, fetchImpl?: typeof fetch) {
    this.config = config;
    this.locked = new NineRouterProvider(config, fetchImpl);
    this.registry.register(this.mock);
    this.registry.register(this.locked);
  }

  resolve(model: string): ResolvedModelRoute {
    return resolveModelRoute(model, this.config);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.mock.listModels();
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletion> {
    const route = this.resolve(request.model);
    if (request.mockFault) {
      const attempts = this.config.maxRetries + 1;
      throw new ModelAttemptError(
        request.mockFault === "timeout" ? "TIMEOUT" : "UNAVAILABLE",
        `Mock ${request.mockFault} sau ${attempts} lần cục bộ. Không gọi mạng.`,
        attempts,
      );
    }
    const provider = this.registry.require("mock");
    const completion = await provider.complete({ ...request, model: route.resolvedModel });
    return {
      ...completion,
      notes: [
        ...route.notes,
        `timeoutMs:${this.config.timeoutMs}`,
        `retriesConfigured:${this.config.maxRetries}`,
        "retriesExecuted:0",
        "billed:false",
      ],
    };
  }
}

export function createModelRouter(config: NineRouterPublicConfig): ModelRouter {
  return new ModelRouter(config);
}
