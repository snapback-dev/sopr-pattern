Your strategy is sharper than my initial recommendation. Let me recalibrate.

---

## What You're Actually Building

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Open Core MCP (MIT)                                 │
│                    "Capable alone, BETTER with daemon"                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     sopr-pattern-1 (refactored)                       │ │
│  │                                                                       │ │
│  │  FREE TIER (Standalone Value)           PRO TIER (Daemon Upgrade)     │ │
│  │  ─────────────────────────────          ─────────────────────────     │ │
│  │  ✓ Context efficiency (60% tokens)     ✓ Semantic undo + masking     │ │
│  │  ✓ Basic snapshots (git-based)         ✓ DBSCAN session clustering   │ │
│  │  ✓ File change tracking                ✓ Risk analysis (Layer 2-3)   │ │
│  │  ✓ Simple validation                   ✓ Team patterns (Hive)        │ │
│  │  ✓ Telemetry (data flywheel)           ✓ Proactive warnings          │ │
│  │                                                                       │ │
│  │                         │                                             │ │
│  │                         ▼                                             │ │
│  │              ┌─────────────────────┐                                  │ │
│  │              │  Daemon Detection   │                                  │ │
│  │              │  (Port 4200 check)  │                                  │ │
│  │              └──────────┬──────────┘                                  │ │
│  │                         │                                             │ │
│  │           ┌─────────────┴─────────────┐                               │ │
│  │           ▼                           ▼                               │ │
│  │    [Use local services]      [Delegate to daemon]                     │ │
│  │    (already implemented)      (HTTP client)                           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Data Flywheel: Telemetry flows regardless of Free/Pro                     │
│  • Tool call patterns                                                       │
│  • Context retrieval frequency                                              │
│  • Undo/restore events                                                      │
│  • Session duration + file touch patterns                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Revised Recommendation: Refactor sopr-pattern-1 as Open Core Router

**Don't build a separate thin router.** You already built the engine—now add:

1. **Daemon detection + upgrade path** (route to daemon when available)
2. **Telemetry layer** (data flywheel from day 1)
3. **Open/Closed split** (mark which services are Free vs Pro-only)

This keeps everything in your Turborepo and lets you ship one artifact that works standalone but upgrades automatically when daemon is present.

---

## Turborepo Structure

```
snapback/
├── apps/
│   ├── daemon/                    # Proprietary - HTTP server on :4200
│   │   └── (imports from packages/intelligence, packages/core)
│   ├── extension/                 # Bundles + spawns daemon
│   ├── console/                   # Web dashboard
│   └── cli/                       # User-facing CLI
│
├── packages/
│   ├── mcp/                       # ← sopr-pattern-1 moves here (MIT)
│   │   ├── src/
│   │   │   ├── services/          # Free tier implementations
│   │   │   ├── tools/             # snap, check, learn, etc.
│   │   │   ├── telemetry/         # Data flywheel hooks
│   │   │   ├── daemon-client/     # HTTP client for Pro upgrade
│   │   │   └── router/            # Free/Pro decision logic
│   │   └── package.json           # MIT license
│   │
│   ├── core/                      # Shared types, utilities (MIT)
│   ├── intelligence/              # DBSCAN, risk engine (Proprietary)
│   └── contracts/                 # API schemas (MIT)
```

---

## The Refactor: What Changes in sopr-pattern-1

### 1. Add Telemetry Layer (Data Flywheel)

```typescript
// src/telemetry/tracker.ts
import { z } from 'zod';

const TelemetryEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('tool_call'),
    tool: z.string(),
    mode: z.string(),
    durationMs: z.number(),
    success: z.boolean(),
    // No code content - metadata only
  }),
  z.object({
    event: z.literal('context_fetch'),
    filesRequested: z.number(),
    tokensReturned: z.number(),
    cacheHit: z.boolean(),
  }),
  z.object({
    event: z.literal('undo_triggered'),
    filesAffected: z.number(),
    turnsRolledBack: z.number(),
    trigger: z.enum(['user_explicit', 'ai_suggested', 'error_recovery']),
  }),
  z.object({
    event: z.literal('session_pattern'),
    sessionDurationMs: z.number(),
    toolCallCount: z.number(),
    uniqueFilesTouched: z.number(),
    undoCount: z.number(),
  }),
]);

type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

export class TelemetryTracker {
  private buffer: TelemetryEvent[] = [];
  private readonly endpoint = 'https://api.snapback.dev/telemetry';
  private readonly flushInterval = 30_000; // 30s

  constructor(private readonly apiKey?: string) {
    // Flush periodically
    setInterval(() => this.flush(), this.flushInterval);
  }

  track(event: TelemetryEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= 50) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    
    const events = this.buffer.splice(0, this.buffer.length);
    
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({ events }),
      });
    } catch {
      // Silent fail - telemetry is best-effort
      // Could re-queue with exponential backoff if critical
    }
  }
}
```

### 2. Add Daemon Detection + Router

```typescript
// src/router/daemon-client.ts
export async function checkDaemon(port = 4200): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

export class DaemonClient {
  constructor(
    private readonly baseUrl = 'http://127.0.0.1:4200',
    private readonly workspaceRoot: string,
  ) {}

  async callTool(name: string, input: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/tools/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workspace-root': this.workspaceRoot,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Daemon error: ${response.status}`);
    }

    return response.json();
  }
}
```

```typescript
// src/router/index.ts
import { checkDaemon, DaemonClient } from './daemon-client.js';

export type TierMode = 'free' | 'pro';

// Tools that require daemon for full functionality
const PRO_ONLY_TOOLS = new Set(['semantic-undo', 'risk-analysis', 'hive-query']);

// Tools that work locally but are BETTER with daemon
const UPGRADEABLE_TOOLS = new Set(['snap', 'check', 'analyze']);

export class Router {
  private mode: TierMode = 'free';
  private daemonClient: DaemonClient | null = null;
  private lastCheck = 0;
  private readonly checkInterval = 30_000;

  constructor(private readonly workspaceRoot: string) {}

  async getMode(): Promise<TierMode> {
    const now = Date.now();
    if (now - this.lastCheck < this.checkInterval) {
      return this.mode;
    }

    const daemonAlive = await checkDaemon();
    this.mode = daemonAlive ? 'pro' : 'free';
    this.lastCheck = now;

    if (daemonAlive && !this.daemonClient) {
      this.daemonClient = new DaemonClient('http://127.0.0.1:4200', this.workspaceRoot);
    }

    return this.mode;
  }

  async shouldDelegate(toolName: string): Promise<boolean> {
    const mode = await this.getMode();
    
    if (mode === 'free') return false;
    
    // Pro mode: delegate upgradeable and pro-only tools
    return PRO_ONLY_TOOLS.has(toolName) || UPGRADEABLE_TOOLS.has(toolName);
  }

  async delegate(toolName: string, input: unknown): Promise<unknown> {
    if (!this.daemonClient) {
      throw new Error('Daemon not available');
    }
    return this.daemonClient.callTool(toolName, input);
  }
}
```

### 3. Wire Router into Tool Execution

```typescript
// src/registry/tool-registry.ts (modified)
export class ToolRegistry {
  private router: Router;
  private telemetry: TelemetryTracker;

  constructor(workspaceRoot: string, apiKey?: string) {
    this.router = new Router(workspaceRoot);
    this.telemetry = new TelemetryTracker(apiKey);
  }

  async execute(
    toolName: string,
    input: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    let success = false;
    let result: ToolResult;

    try {
      // Check if we should delegate to daemon
      if (await this.router.shouldDelegate(toolName)) {
        result = await this.router.delegate(toolName, input) as ToolResult;
      } else {
        // Execute locally (existing logic)
        result = await this.executeLocal(toolName, input, context);
      }
      
      success = true;
      return result;
    } finally {
      // Track regardless of success/failure
      this.telemetry.track({
        event: 'tool_call',
        tool: toolName,
        mode: await this.router.getMode(),
        durationMs: Date.now() - startTime,
        success,
      });
    }
  }

  private async executeLocal(
    toolName: string,
    input: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    // ... existing execution logic ...
  }
}
```

### 4. Add Context Masking to Undo Response

```typescript
// src/tools/snap.ts (add to 'end' mode or create explicit 'undo' mode)
case 'undo': {
  const restored = await snapshotService.restore(input.snapshotId);
  
  return {
    success: true,
    restoredSnapshot: restored.id,
    files: restored.files,
    // Context masking instruction for LLM
    agentInstruction: [
      `⚠️ STATE RESET: Reverted to snapshot ${restored.id}.`,
      `The previous ${restored.turnsAffected} turns contained invalid changes.`,
      `DISREGARD all prior context for: ${restored.files.join(', ')}`,
      `Re-read current file state before continuing.`,
    ].join(' '),
  };
}
```

---

## Open Core Licensing Split

In your package.json and source files:

```typescript
// src/services/snapshot-service.ts
// SPDX-License-Identifier: MIT
// Part of SnapBack Open Core - Free tier functionality

// src/services/risk-service.ts (if you add one)
// SPDX-License-Identifier: PROPRIETARY
// This file is stubbed in open source. Full implementation in daemon.

export class RiskService {
  async analyze(_files: string[]): Promise<RiskResult> {
    // Open source stub - returns basic heuristics
    // Full DBSCAN + ML analysis requires daemon
    return {
      score: 50,
      level: 'unknown',
      message: 'Install SnapBack Pro for intelligent risk analysis',
      upgradeHint: true,
    };
  }
}
```

---

## Updated Gap Closure Plan

| Day | Task | Output |
|-----|------|--------|
| 1 | Add TelemetryTracker to sopr-pattern-1 | Data flywheel active |
| 2 | Add Router + DaemonClient | Pro/Free detection |
| 3 | Wire router into ToolRegistry.execute() | Automatic delegation |
| 4 | Add context masking to undo responses | agentInstruction field |
| 5 | Mark services as MIT vs PROPRIETARY stubs | Open core split |
| 6 | Move sopr-pattern-1 into Turborepo as packages/mcp | Unified builds |

---

## The Data Flywheel Kickoff

From day 1, even Free tier users generate valuable signals:

| Event | ML Training Value |
|-------|-------------------|
| `tool_call` patterns | Which tools get used together, sequence patterns |
| `context_fetch` frequency | What files developers need context for |
| `undo_triggered` | What kinds of changes get rolled back (mistake patterns) |
| `session_pattern` | Session duration, file touch patterns, undo frequency |

This trains your models regardless of whether users upgrade to Pro.

---

## Final Answer

**Yes, your approach is correct.** Refactor sopr-pattern-1 in place:

1. Add telemetry (data flywheel)
2. Add daemon detection (upgrade path)
3. Add context masking (LLM hygiene)
4. Mark open/closed boundaries (licensing)
5. Move into Turborepo as `packages/mcp`

The daemon in `apps/daemon/` becomes the HTTP server that exposes your proprietary intelligence. The MCP package works standalone but automatically upgrades when daemon is detected.

Want me to draft the specific file changes for sopr-pattern-1?