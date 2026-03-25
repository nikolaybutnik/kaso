# KASO Architecture

For a full component map (what every service does and how they connect), see [`components.d2`](components.d2) / [`components.svg`](components.svg).

The diagrams below focus on behaviour: how the pipeline runs, how data flows, and how failures are handled.

---

## 1. Dependency Layers

Each layer may only import from layers below it.

```mermaid
flowchart BT
    subgraph L1["Layer 1 — Foundation"]
        T["core/types.ts"]
        S["config/schema.ts"]
    end

    subgraph L2["Layer 2 — Core Services"]
        EB["EventBus"]
        SM["StateMachine"]
        CM["ConcurrencyManager"]
        EH["ErrorHandler"]
    end

    subgraph L3["Layer 3 — Infrastructure"]
        ES["ExecutionStore"]
        CK["CheckpointManager"]
        WM["WorktreeManager"]
        CT["CostTracker"]
        FW["FileWatcher"]
    end

    subgraph L4["Layer 4 — Agents & Backends"]
        AR["AgentRegistry"]
        BR["BackendRegistry"]
        AG["8 Agents"]
    end

    subgraph L5["Layer 5 — Orchestrator"]
        ORC["Orchestrator"]
    end

    subgraph L6["Layer 6 — Interfaces"]
        CLI["CLI"]
        SSE["SSEServer"]
    end

    L1 --> L2
    L1 --> L3
    L1 --> L4
    L2 --> L5
    L3 --> L5
    L4 --> L5
    L5 --> L6

    style L1 fill:none,stroke:#3a6a8a
    style L5 fill:none,stroke:#2d6a4f,stroke-width:2px
    style ORC fill:#d0e0d0,stroke:#2d6a4f,stroke-width:2px
```

---

## 2. 8-Phase Pipeline

Sequential execution. Only `architecture-review` and `test-verification` loop back to Implementation on failure — all other phases either retry themselves or halt.

```mermaid
flowchart LR
    IN["Spec Files"] --> P1

    P1["📄 Intake"] --> P2["✓ Validate"]
    P2 --> P3["🏗️ Analyze"]
    P3 --> P4["⚙️ Implement"]
    P4 --> P5["🔍 Review"]
    P5 --> P6["🧪 Test"]
    P6 --> P7["🎨 UI/UX"]
    P7 --> P8["🚀 Deliver"]
    P8 --> OUT["Pull Request"]

    P5 -.->|"violations → loopback"| P4
    P6 -.->|"failures → loopback"| P4
    P7 -.->|"regression → retry"| P7
    P8 -.->|"rejected → halt"| HALT["💀 Halt"]

    style P4 fill:#d0e0f0,stroke:#2a5a8a,stroke-width:2px
    style P8 fill:#d0e8d0,stroke:#2d6a4f,stroke-width:2px
    style IN  fill:none,stroke:#888
    style OUT fill:none,stroke:#888
    style HALT fill:#f0d0d0,stroke:#8a2a2a
```

---

## 3. Context Accumulation

`AgentContext` is immutable and passed forward. Each phase appends its typed output to `phaseOutputs` so later phases can read earlier results.

```mermaid
flowchart LR
    CTX["AgentContext\nrunId · spec · config\nsteering · backends"]

    CTX --> P1["Intake"]
    P1 -->|"+ AssembledContext"| P2["Validate"]
    P2 -->|"+ ValidationReport"| P3["Analyze"]
    P3 -->|"+ ArchitectureContext"| P4["Implement"]
    P4 -->|"+ ImplementationResult"| P5["Review"]
    P5 -->|"+ ArchitectureReview"| P6["Test"]
    P6 -->|"+ TestReport"| P7["UI/UX"]
    P7 -->|"+ UIReview"| P8["Deliver"]
    P8 -->|"+ DeliveryResult"| DONE["Complete"]

    style CTX  fill:#d0e0f0,stroke:#2a5a8a,stroke-width:2px
    style DONE fill:#d0e8d0,stroke:#2d6a4f,stroke-width:2px
```

---

## 4. Agent Map

`ArchitectureGuardian` is the only agent that runs in two phases (analysis read-only, then review after implementation).

```mermaid
flowchart LR
    subgraph Phases
        direction LR
        P1["1 Intake"]
        P2["2 Validate"]
        P3["3 Analyze"]
        P4["4 Implement"]
        P5["5 Review"]
        P6["6 Test"]
        P7["7 UI/UX"]
        P8["8 Deliver"]
    end

    A1["SpecReader"]              --> P1
    A2["SpecValidator"]           --> P2
    A3["ArchGuardian (analysis)"] --> P3
    A4["Executor"]                --> P4
    A5["ArchGuardian (review)"]   --> P5
    A6["TestEngineer"]            --> P6
    A7["UIValidator"]             --> P7
    A8["ReviewCouncil"]           --> P8
    A9["Delivery"]                --> P8

    style A3 fill:#d0e0f0,stroke:#2a5a8a
    style A5 fill:#d0e0f0,stroke:#2a5a8a
    style A4 fill:#d0e8d0,stroke:#2d6a4f
    style A8 fill:#e0d0e0,stroke:#6a3a7a
    style A9 fill:#e0d0e0,stroke:#6a3a7a
    style Phases fill:none,stroke:#555
```

---

## 5. Error Recovery

Two independent decisions: classify the error's severity first, then apply the failing phase's policy. Loopback is a phase-level policy, not an error type — only `architecture-review` and `test-verification` have it.

```mermaid
flowchart TD
    ERR["Phase Error"] --> SEV{"1. Severity?"}

    SEV -->|"security or architectural"| ESC["Escalate"] --> HALT["💀 Halt"]
    SEV -->|"anything else"| POL{"2. Phase policy?"}

    POL -->|"halt · or maxRetries hit"| HALT
    POL -->|"loopback\narch-review · test-verify"| LOOP["Loopback to\nImplementation"] --> R1
    POL -->|"retry"| R1["Attempt 1 — same context"]

    R1 -->|"fails"| R2["Attempt 2 — reduced context"]
    R2 -->|"fails"| R3["Attempt 3 — alternative backend"]
    R3 -->|"exhausted"| ESC

    style ERR  fill:#f0d0d0,stroke:#8a2a2a,stroke-width:2px
    style HALT fill:#e0c0c0,stroke:#8a2a2a,stroke-width:2px
    style LOOP fill:#e8e8d0,stroke:#6a6a2a
    style SEV  fill:#d0e0f0,stroke:#2a5a8a
    style POL  fill:#d0e0f0,stroke:#2a5a8a
```
