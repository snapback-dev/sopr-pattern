/**
 * help — Tool discovery and documentation.
 *
 * Modes: tools | status | wire | modes | thresholds | decision | all
 *
 * Pure documentation tool — no service dependencies. Returns plain text
 * to maximise LLM comprehension. This is the "escape hatch" when wire
 * format output from other tools is confusing.
 *
 * @module tools/help
 */

import type { ToolContext } from "../contracts/context.js";
import type { HelpInput } from "../contracts/schemas/tool-inputs.js";

// ---------------------------------------------------------------------------
// Help Content Generators
// ---------------------------------------------------------------------------

function getToolsHelp(): string {
	return `SOPR Available Tools

CORE TOOLS (8):
TOOL        MODES                                   DESCRIPTION
────────────────────────────────────────────────────────────────────
snap        start | check | context | end | undo    Snapshot lifecycle management
check       quick | full | patterns | build |       Code validation & quality gates
            circular | security | coverage |
            orphans | health | evolution |
            integrations
learn       load | save | search                    Learning persistence & retrieval
integrate   git | sentry | github                   External service integrations
pulse       health                                  System health monitoring
graph       deps | files                            Dependency & file graph analysis
cache       errors | patterns                       Error & pattern caching
help        tools | status | wire | modes |         This help (plain text)
            thresholds | decision | all

WORKFLOW:
  1. pulse({ mode: "health" })                  → Check system vitals
  2. snap({ mode: "start", task: "..." })       → Begin task with snapshot
  3. check({ mode: "quick" })                   → Validate code changes
  4. learn({ mode: "save", trigger: "...", action: "..." }) → Capture insight
  5. snap({ mode: "end" })                      → Complete task

Use help({ mode: "decision" }) for the full tool selection guide.`;
}

function getStatusHelp(): string {
	return `SOPR Session Status

STATUS: Active
PROTOCOL: MCP (Model Context Protocol) 2025-03-26
TRANSPORT: stdio | Streamable HTTP
TOOLS: Registered via ToolRegistry
SERVICES: Injected via ServiceContainer

To start a task:
  snap({ mode: "start", task: "your task description" })

To check system health:
  pulse({ mode: "health" })

To validate code:
  check({ mode: "quick" })`;
}

function getWireHelp(): string {
	return `SOPR Wire Format Reference

RESPONSE STRUCTURE:
  [wire format line]
  ---
  [human-readable summary]

FALLBACK: If wire format is confusing, use the human summary after ---.

WIRE FORMAT (labeled by default):
  PREFIX|TYPE|field:value|field:value|...

TYPE CODES:
  S = Snap start response
  C = Check/validation result
  X = Context snapshot
  E = End task summary
  L = Learning captured
  P = Pulse health check
  H = Help (this tool)
  ! = Error

FIELD DECODE (TYPE=S snap start):
  id:      Task identifier
  snap:    Snapshot ID for rollback
  risk:    L=Low, M=Medium, H=High
  prot:    Protection coverage 0-100%
  dirty:   Uncommitted file count
  status:  created|reused|skipped

FIELD DECODE (TYPE=C check):
  status:  pass|fail
  err:     Error count
  warn:    Warning count

STATUS SYMBOLS:
  pass = all checks passed
  fail = one or more checks failed`;
}

function getModesHelp(): string {
	return `SOPR Mode Reference

SNAP MODES (5):
  start   - Begin task: create snapshot, load learnings, enrich context
  check   - Quick validation of current snapshot state
  context - Retrieve current task context with snapshot and learnings
  end     - Complete task: finalize snapshot, persist learnings
  undo    - Revert to snapshot and mask stale context

CHECK MODES (11):
  quick        - Fast lint + typecheck pass
  full         - Comprehensive multi-layer validation
  patterns     - Validate code against project-specific patterns
  build        - Verify project builds without errors
  circular     - Detect circular dependency chains
  security     - Run security vulnerability scans
  coverage     - Evaluate test coverage metrics
  orphans      - Find unreferenced files and dead exports
  health       - Combined codebase health assessment
  evolution    - Track code quality trends over time
  integrations - Validate external integration configurations

LEARN MODES (3):
  load   - Load tiered learnings for current context
  save   - Persist a new learning or pattern
  search - Query learnings by keywords

INTEGRATE MODES (3):
  git    - Gather git repository context (branch, status, commits)
  sentry - Fetch recent Sentry errors
  github - Retrieve GitHub PR and issue data

PULSE MODES (1):
  health - Aggregate health across validation, integrations, graph

GRAPH MODES (2):
  deps  - Compute module-level dependency graph
  files - Map file relationships and import chains

CACHE MODES (2):
  errors   - Retrieve or refresh cached error diagnostics
  patterns - Retrieve or refresh cached pattern matches

HELP MODES (7):
  tools      - List available tools and modes
  status     - Current session information
  wire       - Wire format reference
  modes      - This mode reference
  thresholds - Auto-promotion and risk thresholds
  decision   - Tool selection decision tree
  all        - Comprehensive help (default)`;
}

function getThresholdsHelp(): string {
	return `SOPR Thresholds & Promotion Rules

LEARNING PROMOTION:
  Learnings accessed 3+ times are promoted to "hot tier".
  Hot tier learnings load automatically in relevant task contexts.

RISK LEVELS:
  L (Low)    - Simple changes, well-tested areas
  M (Medium) - Moderate complexity or partial coverage
  H (High)   - Complex changes, critical paths, low protection

CIRCUIT BREAKER STATES:
  closed    - Normal operation, requests flow through
  open      - Service failing, requests short-circuited with fallback
  half-open - Probing recovery, limited requests allowed through

TIMEOUTS:
  Default handler timeout: 30 seconds (configurable via ToolRegistryConfig)
  Retry backoff: exponential with jitter`;
}

function getDecisionTreeHelp(): string {
	return `SOPR Tool Selection Decision Tree

STARTING WORK?
  pulse({ mode: "health" })                        → Check system vitals
  snap({ mode: "start", task: "description" })     → Begin task

MID-TASK:
  Need code validation?     → check({ mode: "quick" })
  Deep security audit?      → check({ mode: "security" })
  Find circular deps?       → check({ mode: "circular" })
  Architecture review?      → check({ mode: "full" })
  Need old version?         → snap({ mode: "undo" })
  Load context?             → snap({ mode: "context" })
  Record learning?          → learn({ mode: "save", trigger: "...", action: "..." })

ANALYSIS:
  Dependency graph?         → graph({ mode: "deps" })
  File relationships?       → graph({ mode: "files" })
  Cached errors?            → cache({ mode: "errors" })
  Pattern cache?            → cache({ mode: "patterns" })

INTEGRATIONS:
  Git context?              → integrate({ mode: "git" })
  Sentry errors?            → integrate({ mode: "sentry" })
  GitHub PRs/issues?        → integrate({ mode: "github" })

ENDING WORK?
  snap({ mode: "end" })                            → Complete task

QUICK REFERENCE:
┌─────────────────┬─────────────────────────────────────────┐
│ I want to...    │ Use this...                             │
├─────────────────┼─────────────────────────────────────────┤
│ Check vitals    │ pulse({ mode: "health" })               │
│ Start work      │ snap({ mode: "start" })                 │
│ Quick check     │ check({ mode: "quick" })                │
│ Deep analysis   │ check({ mode: "full" })                 │
│ Save insight    │ learn({ mode: "save" })                 │
│ Finish task     │ snap({ mode: "end" })                   │
│ Get help        │ help({ mode: "..." })                   │
└─────────────────┴─────────────────────────────────────────┘`;
}

function getAllHelp(): string {
	return `SOPR Quick Reference

TOOLS: snap | check | learn | integrate | pulse | graph | cache | help
TOTAL MODES: 34 across 8 tools

WORKFLOW:
  pulse({ mode: "health" })                    → Check vitals
  snap({ mode: "start", task: "..." })         → Begin task
  check({ mode: "quick" })                     → Validate code
  snap({ mode: "end" })                        → Complete task

TOPICS: help({ mode: "tools|wire|modes|thresholds|decision|status" })`;
}

// ---------------------------------------------------------------------------
// Handler Factory
// ---------------------------------------------------------------------------

/** Creates help tool mode handlers. No service dependencies required. */
export function createHelpHandlers() {
	return {
		async tools(_params: HelpInput, _ctx: ToolContext) {
			return { text: getToolsHelp() };
		},

		async status(_params: HelpInput, _ctx: ToolContext) {
			return { text: getStatusHelp() };
		},

		async wire(_params: HelpInput, _ctx: ToolContext) {
			return { text: getWireHelp() };
		},

		async modes(_params: HelpInput, _ctx: ToolContext) {
			return { text: getModesHelp() };
		},

		async thresholds(_params: HelpInput, _ctx: ToolContext) {
			return { text: getThresholdsHelp() };
		},

		async decision(_params: HelpInput, _ctx: ToolContext) {
			return { text: getDecisionTreeHelp() };
		},

		async all(_params: HelpInput, _ctx: ToolContext) {
			return { text: getAllHelp() };
		},
	};
}
