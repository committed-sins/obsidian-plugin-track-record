# Data model and architecture

## Preview 0.1.1 decisions

- One Markdown file per completed interval or explicit status event. Timer and Status each have a configurable folder (both default to `records/track-record`) and filename pattern (`{type} - {timestamp} - {hash}`). UTC timestamps use seconds and filename-safe time separators; six-character UUID prefixes expand on collisions.
- Classify record types by configurable, case-insensitive tags, independently of storage folders. New notes contain no `track_record` block. Retain older mapping profiles in plugin settings and use those to read older plain records. Read existing 0.1.0 envelopes for compatibility without modifying them.
- Use a single full-path wikilink in the configured subject property. Reject unsupported wikilink path characters instead of guessing. Existing string note IDs are read, never assigned or changed.
- One timer per vault and device. Use public `App.loadLocalStorage` / `saveLocalStorage` for its draft, not synchronized `data.json`. The timer does not write an open interval note. Explicit stop creates a closed interval.
- Store pending timer payload, UUID and destination locally before asynchronous creation. Exact retries succeed; conflicting content is never overwritten. Preserve pending intent if saving or clearing local state fails.
- Reload/shutdown never infers an end time. Recovery asks for an explicit actual end time. Deliberately starting another timer closes the previous local draft at the new start instant, including an interrupted draft; pending saves first retry their original payload. Other devices are not stopped. Sleep/idle time is not automatically subtracted.
- Status capture is command-only: a user-asserted effective timestamp, resulting status and creation timestamp. Repeated statuses are retained. No source-status projection, observer or previous-status inference yet.
- History scans configured/current and retained-profile folders, matching tags and legacy metadata-cache markers. Subject relationships in new records are resolved exclusively from wikilinks. The sidebar keeps current-note actions separate from a running-timer card and the note/all-note history scope. Clock ticks do not trigger record rescans. Refresh after external edits/sync. Persistent indexes and project aggregation are not yet implemented.
- Overlaps across work records, duplicate IDs and invalid records withhold totals. Equal-time status events are flagged, not resolved. No implicit union of overlaps or causal ordering by UUID.
- Only newly created records are written. No source-note writes, migrations, automatic activation, network access or release creation.

## Record storage

Use ordinary Markdown record notes. The examples below show ordinary link/time/status properties; generated records also include `created`. There is no required private metadata block. Plugin `data.json` stores configuration and retained mapping profiles, not tracking history.

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

Work records require an end after start; unfinished intervals exist only as local timer drafts. Status events have no end or previous-status field. Ambiguous tags, conflicting retained profiles and invalid timestamps are refused rather than repaired. Edit properties/text directly and refresh afterward; retain record IDs and subject links. Legacy envelope versions other than version 1 remain unsupported. Pending 0.1.0 timer saves retain their exact original destination and content rather than adopting new names halfway through a write.

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
