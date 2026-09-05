# Memory — explicit local storage and query

CBIM memory is a project-local store used only when the user explicitly asks to
save, query, inspect, or organize memory. It never captures conversations,
loads context automatically, promotes entries, or runs scheduled maintenance.

## Read-only facade

```python
from memory import query, scan, get, stats
```

| Interface | Purpose |
|---|---|
| `query(text, *, tier, limit, ...)` | Keyword retrieval |
| `scan(filter)` | Structured enumeration |
| `get(id_or_path)` | Fetch one entry |
| `stats(filter)` | Counts and health observation |

The current writable tier is `medium`. `candidates` is an explicit maintenance
workspace. The facade rejects the removed `short` tier.

## Explicit write and maintenance operations

The CLI and memory service validate input and use `crud/` for writes. They keep
schema, path, atomic-write, and retrieval-index checks in one place. A write is
not performed merely because a memory Skill matched the request.

```bash
cbim memory create ...
cbim memory query "search terms" [--tier medium] [--top-k N]
cbim memory delete ...
cbim memory cleanup [--keep-days N]
cbim memory reindex [--tier medium]
```

Run cleanup, compaction, candidate review, or rebuild only after the user asks
for that specific maintenance operation. Failures from storage or indexing must
be reported rather than hidden.

## Layout

```text
memory/
├── _facade.py             # query / scan / get / stats
├── cli.py                 # explicit CLI operations
├── config.py              # memory configuration
├── crud/                  # backend and validated persistence primitives
├── compaction/            # explicit candidates, compaction, health, rebuild
└── .dna/                 # module contract and architecture
```

Project data is stored under `.cbim/memory/`:

```text
.cbim/memory/
├── medium/                # saved entries
├── candidates/            # explicit maintenance workspace
├── .index/                # optional local retrieval index
└── .chroma/               # optional Chroma index
```

Existing historical data is preserved. The source package does not delete old
logs, indexes, transcripts, or scheduler data as a side effect of cleanup.

## Backend extension

Add a backend implementing `crud/backend.py`, then select it through the facade
or an explicit caller. The public read signatures remain stable. FileBackend is
the default and needs no extra dependency; Chroma is optional.
