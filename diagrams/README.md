# SOPR Diagrams

Mermaid diagrams for the Service-Oriented Protocol Router pattern. These can be rendered in GitHub, VS Code, or any Mermaid-compatible viewer.

## Architecture Comparison

### Multi-Agent vs SOPR

```mermaid
graph LR
    subgraph "Traditional Multi-Agent"
        MA1[Agent A<br/>1500 tokens] -->|serialize| MA2[Agent B<br/>1500 tokens]
        MA2 -->|serialize| MA3[Agent C<br/>1500 tokens]
    end

    subgraph "SOPR Pattern"
        Tool[Tool<br/>100 tokens] -->|call| SVC1[Service 1]
        Tool -->|call| SVC2[Service 2]
        Tool -->|call| SVC3[Service 3]
        SVC1 -->|return| Tool
        SVC2 -->|return| Tool
        SVC3 -->|return| Tool
    end
```

## Request Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant PS as Protocol Server
    participant TR as Tool Registry
    participant T as Tool Handler
    participant S1 as SnapshotService
    participant S2 as LearningService
    
    C->>PS: JSON-RPC Request
    PS->>TR: dispatch(method, params)
    TR->>TR: validate(Zod schema)
    TR->>T: execute(params, context)
    
    par Parallel Service Calls
        T->>S1: createFromFiles()
        T->>S2: loadTieredLearnings()
    end
    
    S1-->>T: snapshot
    S2-->>T: learnings
    
    T->>T: compose response
    T-->>TR: result
    TR-->>PS: result
    PS-->>C: JSON-RPC Response
```

## Mode-Based Dispatch

```mermaid
flowchart TD
    REQ[Incoming Request] --> PS[Protocol Server]
    PS -->|dispatch| TR[Tool Registry]
    TR -->|validate| ZOD[Zod Schema]
    ZOD -->|extract mode| MODE{Mode?}
    
    MODE -->|start| H1[handleBeginTask]
    MODE -->|check| H2[handleQuickCheck]
    MODE -->|context| H3[handleGetContext]
    
    H1 --> S1[SnapshotService]
    H1 --> S2[LearningService]
    H2 --> S3[ValidationService]
    H3 --> S2
    
    S1 --> RES[Response]
    S2 --> RES
    S3 --> RES
```

## Tool Consolidation

```mermaid
flowchart LR
    subgraph "Before: 24 Tools"
        L1[begin_task]
        L2[get_context]
        L3[quick_check]
        L4[full_check]
        L5[check_patterns]
        L6[check_security]
        L7[...]
    end
    
    subgraph "After: 7 Tools"
        C1[snap<br/>4 modes]
        C2[check<br/>11 modes]
        C3[pulse]
        C4[advise]
    end
    
    L1 --> C1
    L2 --> C1
    L3 --> C2
    L4 --> C2
    L5 --> C2
    L6 --> C2
```

## Circuit Breaker State Machine

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open: 3 failures
    Open --> HalfOpen: 60s cooldown
    HalfOpen --> Closed: success
    HalfOpen --> Open: failure
```

## Deployment Topology

```mermaid
graph TB
    subgraph "LOCAL - SOPR (Optimal)"
        EXT[Extension/CLI]
        PS[Protocol Server]
        TR[Tool Registry]
        S1[SnapshotService]
        S2[LearningService]
        S3[ValidationService]
        
        EXT --> PS --> TR
        TR --> S1
        TR --> S2
        TR --> S3
    end
    
    subgraph "REMOTE - Multi-Agent"
        GH[GitHub MCP]
        SE[Sentry MCP]
        ML[ML Inference]
    end
    
    S3 -.-> GH
    S3 -.-> SE
    S3 -.-> ML
```

## Decision Framework

```mermaid
flowchart TD
    START[New AI Tool Project] --> Q1{Deterministic workflow?}
    
    Q1 -->|YES| Q2{Services co-located?}
    Q1 -->|NO| Q3{AI reasons between steps?}
    
    Q2 -->|YES| SOPR[Use SOPR]
    Q2 -->|NO| FAST[Multi-agent with fast serialization]
    
    Q3 -->|YES| SUPER[Supervisor/Coordinator Pattern]
    Q3 -->|NO| STATE[State Machine]
```