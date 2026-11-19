# Data model and architecture

## Preview 0.1.0 decisions

- One Markdown file per completed interval or explicit status event. Default folder: `records/track-record`; filename: `<start-date>-<time|status>-<uuid>.md`.
- Classify record types by configurable tags. A `track_record` block stores version `1`, writer session, optional existing subject ID and original property/tag/folder mappings. Parsing does not depend on current settings.
- Use a single full-path wikilink in the configured subject property. Reject unsupported wikilink path characters instead of guessing. Existing string note IDs are read, never assigned or changed.
- One timer per vault and device. Use public `App.loadLocalStorage` / `saveLocalStorage` for its draft, not synchronized `data.json`. The timer does not write an open interval note. Explicit stop creates a closed interval.
- Store pending timer payload, UUID and destination locally before asynchronous creation. Exact retries succeed; conflicting content is never overwritten. Preserve pending intent if saving or clearing local state fails.
- Reload/shutdown never infers an end time. A previous session's draft is interrupted and requires an explicit actual end time. Sleep/idle time is not automatically subtracted.
- Status capture is command-only: a user-asserted effective timestamp, resulting status and creation timestamp. Repeated statuses are retained. No source-status projection, observer or previous-status inference yet.
- History scans the configured folder and metadata-cache entries carrying our schema marker. Refresh after external edits/sync. Persistent indexes and project aggregation are not yet implemented.
- Overlaps across work records, duplicate IDs and invalid records withhold totals. Equal-time status events are flagged, not resolved. No implicit union of overlaps or causal ordering by UUID.
- Only newly created records are written. No source-note writes, migrations, automatic activation, network access or release creation.

## Record storage

Use ordinary Markdown record notes in a configurable vault folder. The abbreviated examples below omit the required `track_record` metadata block; see generated records for the complete schema. Plugin `data.json` is not the source of tracking history.

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

Schema version 1 requires an end after the start for work records; unfinished intervals exist only as local timer drafts. Status events have no end or previous-status field. Unknown versions, ambiguous tags and invalid timestamps are refused rather than repaired. Edit record properties/text directly to correct them and refresh history afterward; retain IDs and the metadata block.

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

## Later design decisions

- Concurrent timers and pause/resume beyond stopping one interval and starting another.
- Large-vault/mobile indexing and optional incremental caches.
- Subject-ID adoption/migration and recovery after offline renames without an ID.
- Optional observation of arbitrary property edits beyond explicit commands.
- Current status: retain the source property as a projection, derive it from records, or support both with clear ownership.
- Reconciliation when a status changes while Obsidian is closed.
- Conflict detection, idempotency, corrections and deletion semantics across sync.
- Whether indexes/queries are shared with Bases Excerpts through a public API or independently rebuilt.
- Previewable import of existing intervals/status data; no automatic migration.

## Integration boundaries

Track Record writes tracking records. Templater owns general note templates/schema helpers. Bases Excerpts has planned `records.for`, `records.status`, `records.statusAt`, `records.periods`, `records.duration` and relations functions; their implementation and API feasibility are separate work. Task Trace tracks checkbox task observations and keeps its own event model.
