# Service-Oriented Protocol Router (SOPR)

> A token-efficient alternative to multi-agent architectures for deterministic, tool-heavy AI workflows
>
> **Status**: Production pattern, currently in active use at SnapBack.
> **Audience**: Engineers building AI-powered developer tools (MCP/ACP servers, IDE extensions, CLIs, CLIs, and similar tools).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## TL;DR

Traditional multi-agent architectures for AI tooling suffer from message-passing overhead, context duplication, and debugging complexity. **SOPR (Service-Oriented Protocol Router)** achieves similar benefits (separation of concerns, scalability, resilience) using direct function composition instead of agent-to-agent messaging.

SOPR is validated in production at [SnapBack](https://snapback.dev), where it reduced tool context overhead by ~60% and consolidated 24 tools down to 7.

## Research Context

SOPR was developed inside SnapBack, an AI-native code protection platform, as part of systematic experiments on reducing tool-calling cost and latency while improving debuggability and type safety. This repository codifies that pattern as a **living, versioned artifact**, not just a one-off blog post.

If you are building serious AI tooling (MCP/ACP servers, IDE extensions, CLIs) with 10+ tools, SOPR gives you a production-tested architecture to start from.

---

## The Problem

Building AI-powered developer tools? You face a choice:

| Approach | Problem |
|----------|---------|
| **Monolithic Agent** | 5000+ token context, everything loaded always |
| **Multi-Agent** | Message-passing overhead, debugging nightmare |

Multi-agent architectures fix the monolith, but introduce:

- Serialization overhead between agents (JSON in/out on every hop).
- Context duplication across agents.
- Distributed-debugging complexity (multiple traces, multiple stacks).
- Weaker type safety at message boundaries.

## The Solution: SOPR

**SOPR** achieves multi-agent benefits with direct function composition:

```text
Protocol Server → Tool Registry → Mode-Based Tools → Pure Services
     (routes)       (validates)      (orchestrates)     (executes)
```

- **Protocol servers route, don’t process**: MCP/ACP servers do schema validation and dispatch only.
- **Tools compose services**: Tools are thin orchestrators that call dedicated services.
- **Services are pure**: Stateless, testable functions with clear inputs/outputs.
- **Context flows down**: Shared context is passed as parameters, not hidden in global agent state.
- **Mode-based dispatch**: One tool with multiple modes replaces a proliferation of one-off tools.

For full implementation details, see [`PATTERN.md`](./PATTERN.md).

---

## SnapBack Case Study

Real production metrics from [SnapBack](https://snapback.dev):

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Tool count | 24 | 7 | **71%** |
| Tool discovery tokens | 1200 | 420 | **65%** |
| Context per request | 5000+ | ~1500 | **70%** |
| Avg response time | 340ms | 180ms | **47%** |

**Note**: Results depend on your baseline. See the [full cost analysis](./PATTERN.md#cost-impact-analysis) for calculations and assumptions.

---

## When to Use SOPR ✅

- **AI-powered developer tools** (IDEs, CLI, extensions).
- **Protocol-based integrations** (MCP, ACP, LSP, custom JSON-RPC).
- **10+ tools** that can be consolidated into mode-based tools.
- **Deterministic workflows** (request → process → respond with minimal branching).
- **Co-located services** (same process, shared memory, single stack trace).
- **Strict latency requirements** (sub-100ms where possible).

## When NOT to Use SOPR ❌

SOPR is **not** a universal replacement for multi-agent architectures.

Use traditional multi-agent or other patterns instead if:

- **Adaptive workflows**: AI decides which services to call step-by-step.
- **Distributed systems**: services sit behind network boundaries; serialization + latency dominate.
- **Bidirectional coordination**: agents converse back-and-forth (e.g., Reviewer ↔ Fixer loops).
- **Non-linear workflows**: heavy branching, looping, and fallback chains.
- **Very small toolsets**: **<8 tools** where the engineering cost of SOPR exceeds token savings.

For these cases, see more traditional [multi-agent patterns](https://www.infoq.com/news/2026/01/multi-agent-design-patterns/).

---

## Quick Example

```typescript
// Instead of 24 separate tools...
const tools = [
  'begin_task', 'get_context', 'quick_check',
  'full_check', 'check_patterns', /* ...19 more */
];

// Consolidate into mode-based tools
const snapTool = {
  name: 'snap',
  modes: {
    start: handleBeginTask,
    check: handleQuickCheck,
    context: handleGetContext,
  },
};

// Tools compose pure services (parallel, not sequential)
async function handleBeginTask(params, context) {
  const [snapshot, learnings] = await Promise.all([
    snapshotService.create(params.files),
    learningService.load(params.intent),
  ]);
  return { snapshot, learnings };
}
```

See [`PATTERN.md`](./PATTERN.md#implementation-guide) for a full implementation guide.

---

## Token Savings Depend on Baseline

SOPR’s benefits scale with tool count and baseline architecture.

| Server Type | Tool Count | Expected Savings | Recommendation |
|-------------|-----------|------------------|----------------|
| Simple API wrapper | 3-5 | ~25% | Monolithic may be simpler |
| Standard MCP server | 6-10 | ~50% | SOPR beneficial |
| DevTool (SnapBack) | 15-25 | ~60% | SOPR strongly recommended |
| Complex workflow | 25+ | ~60%+ | SOPR necessary |

**Rule of thumb**: If you have <8 tools, SOPR might be overkill. If you have >12 tools and care about latency/cost, SOPR becomes a strong default.

---

## Key Principles

1. **Protocol servers route, don't process**
2. **Tools compose services, don't contain logic**
3. **Services are pure functions** (stateless, testable)
4. **Context flows down as parameters** (frozen, immutable)
5. **Mode-based dispatch** replaces tool proliferation

These are expanded with concrete TypeScript examples in [`PATTERN.md`](./PATTERN.md).

---

## Red Flags: Outgrowing SOPR

Watch for these patterns that signal you should migrate or complement SOPR with other architectures:

- Tool handlers exceed ~200 lines and accumulate complex control flow.
- Services call services that call services (overly nested call chains).
- Context grows beyond ~5 core fields and becomes hard to reason about.
- Debugging requires distributed tracing across many internal hops.
- Test setup exceeds ~50 lines of mocks / fixtures per test.

See the [migration guide](./PATTERN.md#red-flags-outgrowing-sopr) for more on how to evolve beyond SOPR when these show up.

---

## Diagrams

Mermaid diagrams for SOPR’s architecture, request flow, mode-based dispatch, and deployment topology live under [`./diagrams/README.md`](./diagrams/README.md). GitHub can render these directly.

---

## Documentation Map

- **Pattern whitepaper**: [`PATTERN.md`](./PATTERN.md)
- **Architecture diagrams**: [`diagrams/README.md`](./diagrams/README.md)
- **SnapBack product**: [snapback.dev](https://snapback.dev)
- **Blog article**: [Full SOPR article](https://snapback.dev/blog/sopr-pattern)

---

## License

This project is licensed under the [MIT License](./LICENSE).

---

## Credits

SOPR was developed while building [SnapBack](https://snapback.dev), an AI-native code protection platform. We evolved from 24 tools with monolithic context to 7 consolidated tools with ~60% token reduction.

**Important**: SOPR is validated for deterministic, tool-heavy developer tooling. It is not a universal replacement for all multi-agent architectures; use the [decision framework](./PATTERN.md#decision-framework) to evaluate fit for your system.
