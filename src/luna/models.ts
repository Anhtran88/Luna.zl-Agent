import { PhaseLockedError } from "./domain.ts";
import type { NineRouterPublicConfig } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCompletionRequest {
  model: string;
  messages: ChatMessage[];
}

export interface ModelInfo {
  id: string;
  providerId: "mock" | "nine-router";
  description: string;
}

export interface ModelCompletion {
  providerId: "mock" | "nine-router";
  model: string;
  content: string;
  dryRun: true;
  network: false;
  notes: string[];
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
    return {
      providerId: "mock",
      model: request.model,
      content: `Mock ${request.model} không gọi mạng. Số tin nhắn: ${request.messages.length}.`,
      dryRun: true,
      network: false,
      notes: ["provider:mock", "network:blocked"],
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

export class ModelRouter {
  private readonly mock = new MockModelProvider();
  private readonly config: NineRouterPublicConfig;

  constructor(config: NineRouterPublicConfig) {
    this.config = config;
  }

  resolve(model: string): ResolvedModelRoute {
    return resolveModelRoute(model, this.config);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.mock.listModels();
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletion> {
    const route = this.resolve(request.model);
    const completion = await this.mock.complete({ ...request, model: route.resolvedModel });
    return { ...completion, notes: route.notes };
  }
}

export function createModelRouter(config: NineRouterPublicConfig): ModelRouter {
  return new ModelRouter(config);
}
