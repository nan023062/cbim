---
name: services
owner: programmer
description: Validated service facades for knowledge, agents, skills, and memory
keywords:
  - services
  - facade
  - validation
  - reindex
status: implemented
dependencies: []
---

## Positioning

Services provide stable read/write boundaries between CLI or resource callers and volatile
storage primitives. They centralize validation, path safety, atomic updates, and post-write
index synchronization.

## Class Diagram

```mermaid
classDiagram
    class KnowledgeService
    class AgentService
    class SkillService
    class MemoryService
    class PathGuards
    class Reindex
    KnowledgeService --> PathGuards
    AgentService --> PathGuards
    SkillService --> PathGuards
    KnowledgeService --> Reindex
    AgentService --> Reindex
    SkillService --> Reindex
    MemoryService --> Reindex
```

## Key Decisions

- **One governed boundary**: callers use service functions rather than private primitives,
  keeping validation and error semantics consistent.
- **Explicit operations**: services do not dispatch agents, start background work, or mutate
  memory without an explicit request.
- **Visible index state**: post-write reindexing is part of the service contract; failures are
  returned or raised instead of being hidden.
