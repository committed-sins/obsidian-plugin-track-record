# Data model and architecture

## Proposed storage

Use ordinary Markdown record notes in a configurable vault folder. One record per work interval or status transition is the starting proposal; batching and file layout are not frozen. Do not use plugin `data.json` as the sole source of tracking history.

Illustrative closed work interval:

```yaml
---
id: 0db124ac-bbf7-4199-814e-d9c2d57359a0
tags:
  - record/time
contexts:
  - "[[Example note]]"
time_start: 2026-11-18T09:00:00+01:00
time_end: 2026-11-18T09:45:00+01:00
---
```

Illustrative status transition:

```yaml
---
id: 202583f8-fc28-4571-b31c-6a409c39efc0
tags:
  - record/status
contexts:
  - "[[Example note]]"
time_start: 2026-11-18T09:00:00+01:00
status: ongoing
---
```

These are illustrative schema candidates, not templates to apply to an existing vault. The meaning of a missing `time_end`, previous status, observation timestamps, record revisions and device/session identifiers must be specified before implementation.

## Responsibilities

| Component | Intended responsibility |
| --- | --- |
| Commands and UI | Start/stop, manual entries, status changes and explicit corrections. |
| Record service | Validation, stable IDs, guarded Markdown writes and record lifecycle. |
| Optional status observer | Detect configured property changes using an explicit capture policy. |
| Local session state | Device-local timer recovery; no shared mutable timer across devices. |
| Record index | Rebuildable cache of records and subjects; source records remain authoritative. |
| Bases / Bases Excerpts | Read-only selection, relations and aggregation; no record creation in formulas. |

## Time semantics

Work duration measures recorded work intervals. Status duration measures elapsed time between effective status transitions. Neither implies the other. Preserve timestamp offsets, compare instants, and distinguish unknown end times from zero duration.

Identical effective timestamps need an ambiguity/tie policy. Wall-clock order alone does not prove causal order between devices. A property change seen after sync is an observation, not evidence of its original timestamp.

## Open design decisions

- Single timer or concurrent timers; pause/resume representation.
- Record filenames, folder layout and expected large-vault/mobile indexing cost.
- Stable subject identity: existing note IDs, wikilinks and rename/move behavior.
- Explicit status commands versus observation of arbitrary property edits.
- Current status: retain the source property as a projection, derive it from records, or support both with clear ownership.
- Reconciliation when a status changes while Obsidian is closed.
- Conflict detection, idempotency, corrections and deletion semantics across sync.
- Whether indexes/queries are shared with Bases Excerpts through a public API or independently rebuilt.
- Previewable import of existing intervals/status data; no automatic migration.

## Integration boundaries

Track Record writes tracking records. Templater owns general note templates/schema helpers. Bases Excerpts has planned `records.for`, `records.status`, `records.statusAt`, `records.periods`, `records.duration` and relations functions; their implementation and API feasibility are separate work. Task Trace tracks checkbox task observations and keeps its own event model.
