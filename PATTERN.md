# The Service-Oriented Protocol Router Pattern (SOPR)
## A Token-Efficient Alternative to Multi-Agent Architectures for AI Tool Systems

*Consolidating a tool surface and simplifying debugging without agent-to-agent
communication overhead.*

- **Status**: Reference specification with a working implementation in this repository. No published benchmark.
- **Version**: v1.0.0
- **Last updated**: 2026-02-03

---

## 1. Overview

Traditional multi-agent architectures for AI tooling promise modularity and specialization, but in practice they often introduce heavy message-passing overhead, duplicated context, and complex distributed debugging.

The **Service-Oriented Protocol Router (SOPR)** pattern keeps the benefits of separation of concerns and scalability, but replaces agent-to-agent messaging with **direct function composition**:

```text
Protocol Server → Tool Registry → Mode-Based Tools → Pure Services
     (routes)       (validates)      (orchestrates)     (executes)
```

SOPR was developed inside a proprietary developer-intelligence MCP server and is
implemented here as a brand-neutral reference. It:

- Replaces one-tool-per-operation with a small set of mode-dispatched tools —
  8 tools carrying 34 modes in this implementation, derived programmatically in
  [`src/contracts/tool-map.ts`](./src/contracts/tool-map.ts).
- Keeps debugging in a single process with ordinary stack traces and typed boundaries.
- Reduces tool-discovery context, because the model sees tool descriptions rather than
  one description per operation. How much depends on your baseline; see
  [§7 Cost Impact Analysis](#7-cost-impact-analysis) for the model.

The originating measurements were taken against a private MCP server and have never
been published in reproducible form, so they are not restated here as results.

This document is the **reference specification** for SOPR.

---

## 2. Problem: Monolith vs Multi-Agent

When building AI-powered developer tools, you typically face two extremes.

### 2.1 Monolithic Agent

A single agent with all capabilities baked into one massive context:

```text
Single Agent Context (~5000+ tokens):
├── Snapshot management rules
├── Code analysis patterns
├── Git integration logic
├── Error handling procedures
├── Learning retrieval algorithms
├── Dependency graph rules
├── Security scanning patterns
└── ... everything else
```

**Issues**:

- Large, ever-growing prompt (expensive per call).
- Hard to reason about which parts of context are actually needed.
- Tight coupling between concerns; refactoring is risky.

### 2.2 Multi-Agent Architecture

Multiple specialized agents coordinate via message passing (often JSON over some bus). Conceptually clean, but in practice:

- Each hop incurs serialization/deserialization cost.
- Each agent maintains overlapping context.
- Debugging requires tracking flows across multiple agents and transports.
- Type safety is weaker at message boundaries.

The result: you trade monolithic complexity for **distributed complexity**.

---

## 3. The SOPR Pattern

SOPR is a hybrid that keeps **specialization** but eliminates inter-agent messaging inside the process.

### 3.1 Core Principles

1. **Protocol servers route, don't process**  
   MCP/ACP servers validate and dispatch; no domain logic.
2. **Tools compose services**  
   Tools are thin orchestrators that call domain services.
3. **Services are pure functions**  
   Stateless, testable, config-driven business logic.
4. **Context flows down as parameters**  
   Immutable context objects passed through, no mutation.
5. **Mode-based dispatch replaces tool proliferation**  
   A handful of tools with multiple modes instead of many one-off tools.

### 3.2 High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    External Clients                        │
│  Editor / AI Assistant / Extension / CLI                   │
└───────────────┬────────────────────────────────────────────┘
                │ (MCP / ACP / JSON-RPC)
                ▼
┌─────────────────────────────────────────────────────────────┐
│                 Protocol Server (Route Only)                │
│  • Validate request schema                                 │
│  • Construct frozen context                                │
│  • Dispatch to ToolRegistry                               │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│                      Tool Registry                          │
│  • Register tools with Zod schemas                         │
│  • Mode-based dispatch (tool + mode)                       │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│                  Mode-Based Tools (Orchestrators)           │
│  • snap, check, pulse, learn, integrate, ...               │
│  • No business rules; only orchestration & shaping result  │
└───────────────┬────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer (Pure Functions)           │
│  • SnapshotService, LearningService, ValidationService     │
│  • IntegrationOrchestrator, GraphService, ErrorCache      │
└─────────────────────────────────────────────────────────────┘
```

Compared to multi-agent systems, everything here is **in-process function calls** with shared context, not remote messages.

---

## 4. Worked example: consolidating a 24-tool surface

> **Provenance.** This example is drawn from the private MCP server SOPR was extracted
> from (originally SnapBack, now [Vreko](https://vreko.dev)). That server is not public,
> so the *before* state cannot be inspected and the figures in §4.3 cannot be
> reproduced by a reader. It is included because the shape of the consolidation is the
> useful part; the numbers are not offered as evidence.

The server originally exposed **24 tools** sharing one large context.

### 4.1 Before: 24 tools

```text
24 Tools:
├── begin_task, get_context, end_task, abandon_task
├── quick_check, full_check, check_patterns, check_security
├── check_build, check_circular, check_coverage, check_orphans
├── check_health, check_evolution, check_integrations
├── load_learnings, save_learning, search_learnings
├── git_context, dependency_graph, error_cache
└── ... 4 more

Context per request: ~5000+ tokens
Tool discovery overhead: 24 tools × ~50 tokens/tool = 1200 tokens
```

### 4.2 After: 7 mode-based tools

```text
7 Tools:
├── snap (modes: start, check, context, end)
├── check (modes: quick, full, patterns, build, circular, security, coverage, orphans, health, evolution, integrations)
├── learn (modes: load, save, search)
├── integrate (modes: git, sentry, github)
├── pulse (modes: health)
├── graph (modes: deps, files)
└── cache (modes: errors, patterns)

Underlying services:
├── SnapshotService
├── DriftDetector
├── LearningSynthesizer
├── IntegrationOrchestrator
├── ValidationService
└── GraphService
```

### 4.3 Reported figures — not reproducible

| Metric | Before | After |
|--------|--------|-------|
| Tool count | 24 | 7 |
| Tool discovery tokens | 1200 | 420 |
| Context per request | 5000+ | ~1500 |
| Avg response time | 340ms | 180ms |

**Read these as history, not as evidence.** They were recorded against a private server
with no published methodology, no harness and no released dataset. Nothing in this
repository reproduces them. Do not cite them as a benchmark result for SOPR.

For a claim you *can* check, see the tool/mode counts derived from
[`src/contracts/tool-map.ts`](./src/contracts/tool-map.ts).

### 4.4 Baseline matters

The table below is an **estimate from the cost model in §7**, not a measurement:

| Your Tool Count | Modelled Savings | Worth the Effort? |
|-----------------|------------------|-------------------|
| 3–5 tools | ~25% | Probably not |
| 6–10 tools | ~50% | Yes, if latency-sensitive |
| 15+ tools | ~60%+ | Strongly recommended |

See the [Cost Impact Analysis](#7-cost-impact-analysis) for more detailed math.

---

## 5. Implementation Guide

This section shows SOPR in code, in TypeScript-flavored pseudocode.

### 5.1 Layer 1: Protocol Server (Router)

The protocol layer should validate requests, construct a context object, and delegate to the registry.

```typescript
class ProtocolServer {
  constructor(private registry: ToolRegistry, private config: AppConfig) {}

  async handleRequest(method: string, params: unknown): Promise<unknown> {
    const tool = this.registry.get(method);
    if (!tool) throw new Error(`Unknown tool: ${method}`);

    const context = Object.freeze({
      workspacePath: this.config.workspacePath,
      sessionId: this.config.sessionId,
      capabilities: Object.freeze([...this.config.capabilities]),
    } as const);

    return tool.execute(params, context);
  }
}
```

**Anti-pattern to avoid**:

```typescript
// ❌ Do not put business logic in the protocol server
async handleRequest(method: string, params: unknown) {
  if (method === "analyze") {
    const files = await fs.readdir(params.path); // business logic
    const risks = files.map(f => this.calculateRisk(f));
    return { risks };
  }
}
```

### 5.2 Layer 2: Tool Registry

The registry maps tool names to definitions with schemas and (optionally) modes.

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: ZodSchema<TInput>;
  modes?: Record<string, ModeHandler<TInput, TOutput>>;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any>>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>) {
    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  async execute(name: string, params: unknown, context: ToolContext) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    const validated = tool.inputSchema.parse(params);

    if (tool.modes && "mode" in validated) {
      const handler = tool.modes[validated.mode];
      if (!handler) throw new Error(`Unknown mode: ${validated.mode}`);
      return handler(validated, context);
    }

    return tool.execute(validated, context);
  }
}
```

### 5.3 Layer 3: Mode-Based Tools

Consolidate multiple related tools into one tool with modes.

```typescript
const SnapParamsSchema = z.object({
  mode: z.enum(["start", "check", "context"]),
  files: z.array(z.string()),
  intent: z.string().optional(),
});

type SnapParams = z.infer<typeof SnapParamsSchema>;

type SnapResult = {
  status: "ok" | "error";
  data?: unknown;
};

const snapTool: ToolDefinition<SnapParams, SnapResult> = {
  name: "snap",
  description: "Snapshot operations. Modes: start, check, context",
  inputSchema: SnapParamsSchema,
  modes: {
    start: handleBeginTask,
    check: handleQuickCheck,
    context: handleGetContext,
  },
  async execute(params, context) {
    const handler = this.modes?.[params.mode];
    if (!handler) throw new Error(`Unsupported mode: ${params.mode}`);
    return handler(params, context);
  },
};
```

### 5.4 Layer 4: Services (Pure Functions)

Services encapsulate business rules and are testable in isolation.

```typescript
interface SnapshotService {
  createFromFiles(files: string[], options: CreateOptions): Promise<Snapshot>;
}

class SnapshotServiceImpl implements SnapshotService {
  constructor(
    private workspacePath: string,
    private storage: StorageAdapter,
    private logger: Logger,
  ) {}

  async createFromFiles(files: string[], options: CreateOptions): Promise<Snapshot> {
    const contents = await Promise.all(
      files.map(f => this.storage.read(path.join(this.workspacePath, f)))
    );

    const hash = this.computeContentHash(contents);

    const existing = await this.storage.findByHash(hash);
    if (existing) {
      this.logger.debug("Reusing existing snapshot", { hash });
      return { ...existing, reused: true };
    }

    return this.storage.write({
      files,
      contents,
      hash,
      metadata: options.metadata,
      createdAt: new Date(),
    });
  }

  private computeContentHash(contents: string[]): string {
    // Domain-specific hashing strategy goes here
    return "…";
  }
}
```

### 5.5 Layer 5: Orchestration in Tools

Tools orchestrate multiple services in parallel and format a response.

```typescript
async function handleBeginTask(params: SnapParams, context: ToolContext): Promise<SnapResult> {
  const snapshotService = getSnapshotService(context.workspacePath);
  const learningService = getLearningService(context.workspacePath);
  const integrationService = getIntegrationService();

  const [snapshot, learnings, enrichment] = await Promise.all([
    snapshotService.createFromFiles(params.files, {
      description: params.intent ?? "",
      trigger: "manual",
    }),
    learningService.loadTieredLearnings({
      intent: params.intent,
      filePaths: params.files,
    }),
    integrationService.enrichContext({
      files: params.files,
      intent: params.intent,
    }),
  ]);

  return {
    status: "ok",
    data: {
      snapshotId: snapshot.id,
      learnings: learnings.slice(0, 5),
      riskScore: enrichment.riskScore,
    },
  };
}
```

---

## 6. Resilience Patterns

SOPR is often used as the **in-process core** of a system that coordinates with external services (GitHub, Sentry, other MCP servers). To keep the system robust, we apply:

- Circuit breakers.
- Concurrency limits.
- Retries with backoff.
- Graceful degradation (return `null` instead of throwing).

### 6.1 Circuit Breakers

Use a production-grade circuit breaker implementation (e.g., Opossum) and wrap external calls:

```typescript
import CircuitBreaker from "opossum";

interface CircuitConfig {
  timeoutMs: number;
  errorThresholdPercentage: number;
  resetTimeoutMs: number;
  volumeThreshold: number;
}

const DEFAULT_CONFIG: CircuitConfig = {
  timeoutMs: 5_000,
  errorThresholdPercentage: 50,
  resetTimeoutMs: 30_000,
  volumeThreshold: 10,
};

const breakers = new Map<string, CircuitBreaker<any, any>>();

export function withCircuitBreaker<I, O>(
  name: string,
  fn: (input: I) => Promise<O>,
  config: Partial<CircuitConfig> = {},
): (input: I) => Promise<O> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!breakers.has(name)) {
    const breaker = new CircuitBreaker(fn, {
      timeout: cfg.timeoutMs,
      errorThresholdPercentage: cfg.errorThresholdPercentage,
      resetTimeout: cfg.resetTimeoutMs,
      volumeThreshold: cfg.volumeThreshold,
    });

    breakers.set(name, breaker);
  }

  return (input: I) => breakers.get(name)!.fire(input);
}
```

### 6.2 Graceful Degradation

External integrations should **never** throw when used from tools; they should return `null` or a typed error/result object.

```typescript
async function getGitHubContext(files: string[]): Promise<GitHubContext | null> {
  try {
    const response = await fetch("https://api.github.com/…");
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
```

---

## 7. Cost Impact Analysis

SOPR is not just an architectural choice; it has significant cost implications.

### 7.1 Example Scenario

Assume:

- 10,000 users.
- 1000 requests/hour.
- Model cost: $3 per 1M tokens.

**Baseline (monolithic):**

- 3000 tokens/request → 3,000,000 tokens/hour → $9/hour → ~$78,840/year.

**With SOPR:**

- 1200 tokens/request → 1,200,000 tokens/hour → $3.60/hour → ~$31,536/year.

**Savings: ~$47,000/year (~60%)**.

### 7.2 Calculating Your Own ROI

```typescript
function calculateSOPRAnnualSavings(config: {
  dailyRequests: number;
  currentTokensPerRequest: number;
  soprTokensPerRequest: number;
  costPerMillionTokens: number;
}) {
  const { dailyRequests, currentTokensPerRequest, soprTokensPerRequest, costPerMillionTokens } = config;

  const currentDailyCost = (dailyRequests * currentTokensPerRequest / 1_000_000) * costPerMillionTokens;
  const soprDailyCost = (dailyRequests * soprTokensPerRequest / 1_000_000) * costPerMillionTokens;

  const dailySavings = currentDailyCost - soprDailyCost;
  const annualSavings = dailySavings * 365;

  return {
    currentAnnualCost: currentDailyCost * 365,
    soprAnnualCost: soprDailyCost * 365,
    annualSavings,
    percentageReduction: ((
      currentTokensPerRequest - soprTokensPerRequest
    ) / currentTokensPerRequest * 100).toFixed(1),
  };
}
```

---

## 8. Tradeoffs & Limitations

SOPR is powerful in the right context, but it has limits.

### 8.1 When SOPR Shines

- High tool count (10+ tools) where discovery and per-tool context matter.
- Deterministic, mostly linear workflows.
- Co-located services in a single process (e.g., IDE extension, local MCP server).
- Teams that value debuggability and strong typing over “black-box” emergent behavior.

### 8.2 When to Avoid or Complement SOPR

- Highly dynamic orchestration where the AI needs to plan multi-step workflows.
- Systems that are inherently distributed across many services/processes.
- Workflows involving long-running, asynchronous coordination between agents.

In these cases, use SOPR as the **local execution engine** and connect it to:

- Supervisor/coordinator agents.
- State machines.
- Event-driven multi-agent systems.

---

## 9. Related Work

SOPR is related to several existing ideas:

- **Multi-agent orchestration patterns** (Google, IBM, others) for complex AI workflows.
- **Hexagonal / clean architecture** for separating protocols, application, and domain.
- **Circuit breaker and bulkhead patterns** for resilient external calls.
- **MCP/ACP** as standardized protocol layers.

We explicitly position SOPR as a **local architecture pattern for AI tool servers**, complementary to higher-level coordination patterns.

---

## 10. Decision Framework

A quick decision tree for whether SOPR fits your use case:

```text
Is your workflow deterministic (same input → same service calls)?
├── YES → Are services co-located (same process)?
│         ├── YES → SOPR is ideal.
│         └── NO  → Multi-agent with fast serialization.
└── NO  → Does the AI need to reason between steps?
          ├── YES → Supervisor/coordinator pattern.
          └── NO  → Consider a state machine or workflow engine.
```

For Mermaid diagrams of this decision framework and the overall architecture, see [`diagrams/README.md`](./diagrams/README.md).

---

## 11. How to Cite SOPR

If you reference SOPR in your own documentation, blog posts, or papers, we suggest:

> Service-Oriented Protocol Router (SOPR) pattern, for deterministic, tool-heavy AI developer tooling.  
> Repository: https://github.com/vreko-dev/sopr-mcp

You can also link directly to this document (`PATTERN.md`) for implementation details.

---

## 12. Open Questions & Future Work

SOPR as described here is validated for **deterministic, tool-heavy developer tooling**. Open areas we are exploring:

- Hybrid SOPR + multi-agent systems where SOPR acts as the local execution engine under a higher-level planner.
- Distributed variants where SOPR’s services are split across processes while preserving most benefits.
- Automated tooling for measuring token savings and suggesting SOPR-style consolidations in existing MCP servers.

Contributions and feedback are welcome via issues and pull requests in this repository.
