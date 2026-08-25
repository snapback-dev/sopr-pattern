<p><img width="2172" height="724" alt="vreko-lockup" src="https://github.com/user-attachments/assets/fddd90b6-4bb5-4985-8f73-3b63060c526f" /></p>

# Service-Oriented Protocol Router (SOPR)

> A token-efficient alternative to multi-agent architectures for deterministic, tool-heavy AI workflows
>
> **Status**: An architecture pattern extracted from a developer-tooling MCP server,
> published here as a working reference implementation. No benchmark is published.
> **Audience**: Engineers building AI-powered developer tools (MCP/ACP servers, IDE extensions, CLIs, CLIs, and similar tools).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## TL;DR

Traditional multi-agent architectures for AI tooling suffer from message-passing overhead, context duplication, and debugging complexity. **SOPR (Service-Oriented Protocol Router)** achieves similar benefits (separation of concerns, scalability, resilience) using direct function composition instead of agent-to-agent messaging.

This repository implements SOPR directly. The consolidation it produces is checkable from the source: `src/contracts/tool-map.ts` exposes **8 tools carrying 34 modes**, and `TOOL_COUNT` / `TOTAL_MODE_COUNT` are derived from that map rather than written by hand — so the numbers in this README cannot drift from the code without a test failing.

## Research Context

SOPR was developed inside a proprietary developer-intelligence product (originally named SnapBack, now [Vreko](https://vreko.dev)) while working on tool-calling cost, latency, debuggability and type safety. This repository codifies the pattern as a **living, versioned artifact** rather than a one-off blog post.

The originating measurements were taken against that product's private MCP server and have never been published in reproducible form, so they are not repeated here as results.

If you are building AI tooling (MCP/ACP servers, IDE extensions, CLIs) with 10+ tools, SOPR gives you a worked architecture to start from — with the caveat that the savings you get depend entirely on your baseline.

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

## What this repository establishes

The pattern below is implemented here and covered by tests. What you can check without
taking anything on faith:

| Claim | Where to check |
|---|---|
| Mode-based dispatch replaces one-tool-per-operation | [`src/contracts/tool-map.ts`](./src/contracts/tool-map.ts) — 8 tools, 34 modes |
| Protocol servers route and validate; they do not execute | [`src/protocol/server.ts`](./src/protocol/server.ts) |
| Services are pure and independently testable | [`src/contracts/services.ts`](./src/contracts/services.ts) and the unit suite |
| The OSS layer contains no proprietary references | [`tests/integration/oss-ip-guard.test.ts`](./tests/integration/oss-ip-guard.test.ts) |

**What it does not establish.** No token-reduction, latency or cost figure is published
for SOPR, because no reproducible benchmark has been published to support one. The
before/after numbers previously shown here came from a private MCP server that cannot
be inspected, so they were not evidence a reader could check.

See the [cost analysis](./PATTERN.md#cost-impact-analysis) for the calculation method and its assumptions.

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

## Token savings depend on your baseline

The figures below are **estimates from the cost model in [`PATTERN.md`](./PATTERN.md#cost-impact-analysis)**, not measurements. Treat them as a sizing heuristic and measure your own baseline before relying on them.

| Server Type | Tool Count | Expected Savings | Recommendation |
|-------------|-----------|------------------|----------------|
| Simple API wrapper | 3-5 | ~25% | Monolithic may be simpler |
| Standard MCP server | 6-10 | ~50% | SOPR beneficial |
| Developer tooling | 15-25 | ~60% | SOPR strongly recommended |
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
- **Originating product**: [vreko.dev](https://vreko.dev) (formerly SnapBack)

---

## License

This project is licensed under the [MIT License](./LICENSE).

---

## Credits

SOPR was developed while building the product now called [Vreko](https://vreko.dev), moving from one tool per operation with a shared monolithic context to a small set of mode-dispatched tools. This repository is the extracted, brand-neutral reference implementation.

**Important**: SOPR is designed for deterministic, tool-heavy developer tooling. It is not a universal replacement for all multi-agent architectures; use the [decision framework](./PATTERN.md#decision-framework) to evaluate fit for your system.
