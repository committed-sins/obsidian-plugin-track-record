# Data model and architecture

## Release candidate 0.1.6

- Timer and Status records are ordinary Markdown notes. New notes have no `id` or `track_record` identity field. Their vault paths identify them internally. Existing IDs/envelopes are read for compatibility only.
- Each type has a configurable filename base (`{type} - {timestamp}` by default), with a fixed six-character random `.{hash}.md` suffix. Never lengthen it to a UUID. A collision reports an ordinary note conflict without overwriting. No extra sync identity or collision-repair protocol is promised.
- Optional current-user name is local configuration, not a device identity. Use the same name across devices. Exact name matches select open timers; an empty current user selects only unassigned timers. Old device names and reset-all flags cannot bypass this rule. This is an organizational convention, not access control.
- Timer defaults are `record.user`, `record.start`, `record.end`. Status effective time also defaults to `record.start`; it has no user/device field. Dot notation creates nested YAML; flat names work too. Reserved/prototype paths, scalar parents and ancestor/descendant overlaps are rejected.
- Each type has its own subject property, defaulting to `contexts`. Scalar or list wikilinks and aliases are accepted; writing uses a list. Duplicate targets are ignored. Several Timer subjects share the full interval, counted once globally and once in each target view. Several Status subjects receive the same asserted status, explicitly described in the dialog. No implicit fractional allocation.
- Start/Stop re-read open timer notes: the end is absent, null or empty/whitespace, and the optional user matches. Start closes matching notes at the replacement's start instant, then creates the new open note. No local active-timer/session list is written. Reload leaves open records open; sleep/idle time is not subtracted.
- Preflight all candidate closures before writing. Each `Vault.process` callback reparses fresh content and checks path/legacy ID, user, start, raw subject links and end mapping before updating the YAML AST. Preserve comments, unrelated fields and body. Writes across files are not atomic: a later I/O failure can leave earlier notes closed, but no replacement timer starts.
- New creation uses a random in-memory suffix and guarded creation; no filename conflict overwrites an existing file. A retry of the same known write intent accepts only identical content.
- The old local-draft reader exists only for explicit recovery/discard of 0.1.0/0.1.1 state. It does not start new timers. Legacy pending saves preserve their exact original bytes and path.
- Status capture is command-only: effective time, resulting status and normal creation timestamp. No source-status projection, automatic observer or previous-status inference.
- Source notes remain unchanged. Record operations create notes or explicitly set timer end fields. No automatic migration, activation, network request or release creation.

## Storage examples

Generated notes also include a normal `created` timestamp. User is omitted when unconfigured.

```yaml
---
tags: [record/time]
contexts:
  - "[[Project A]]"
  - "[[Project B]]"
record:
  user: Alice
  start: "2026-11-20T08:00:00.000Z"
  end: null
---
```

```yaml
---
tags: [record/status]
contexts:
  - "[[Project A]]"
record:
  start: "2026-11-20T08:00:00.000Z"
status: ongoing
---
```

- New timer, manual and status timestamps use UTC. Native datetime-local fields convert local calendar input to UTC and reject nonexistent DST times. Older offset timestamps and exact legacy pending-save bytes remain unchanged.

## Entry dialogs and sections

Subject selections use a FuzzySuggestModal and a deduplicated set of paths; save revalidates targets. AbstractInputSuggest provides editable status suggestions from parsed status records across current and retained mappings. Ctrl/Cmd+Enter invokes the same guarded save action as the button, including frozen retries. Notes are literal Markdown under a configurable level-two heading. A link picker uses Obsidian's link-format preference relative to the destination folder; MarkdownRenderer supplies an explicit preview with a modal-owned Component lifecycle. Existing records and frozen legacy pending-save bytes are not rewritten. Timer and Status view modes share note/scope selection but separate actions, records and work totals.

## Local interruption reminders

`track-record:presence:v1` is vault-local installation storage, separate from shared settings. Current observations contain only a record path, start, exact owner, timestamp and boundary reason. They never establish whether an interval is open: Markdown is authoritative. Workspace quit records the beginning of a normal shutdown; plugin unload is explicitly different. A 30-second heartbeat is best effort for crashes/mobile kills. Observation snapshots update after record scans and explicit operations.

On startup, current observations join any deferred reminders, keeping the earliest unresolved boundary per path/start/user. Match fresh open records for the current user only. The modal offers continue, the observed end or a custom local end converted to UTC. The guarded Vault.process path revalidates the current record before an end is written. Newly created timers and other users are excluded. A synced end/replacement clears a stale reminder; missing or invalid files retain it for late synchronization. Dismissing preserves the decision across restarts; a review command reopens it. No background record writes occur. Corrupt local reminders are preserved and disabled with a notice rather than overwritten.

## Compatibility and indexing

Keep existing notes and explicit configured paths unchanged. Retained mapping profiles are normal plugin configuration; old time_start/time_end and timer.start/timer.end have compatibility profiles. Device fields never become users. A populated user/end mapping can distinguish a profile from one with missing fields; conflicting populated profiles fail. Unknown legacy envelope versions fail instead of being rewritten.

The history list is rebuildable from notes and metadata-cache candidates. Vault changes debounce refresh; clock ticks do not rescan. Links resolve through native Obsidian metadata. Ambiguous status times, malformed records and overlapping closed work intervals remain visible. Closed work totals exclude open intervals; shared intervals count once in global totals. Per-project/subject totals overlap and must not be added as disjoint work.

## Integration and later decisions

Track Record writes tracking records. Templater owns general note/schema helpers. Planned Bases Excerpts relations and records functions remain read-only. Task Trace keeps its independent checkbox observation model.

Later work: configurable record types (labels, tags, folders, property mappings and notes headings), with interval behavior reserved for timer-capable types; status/current-state projections, recursive project aggregation with cycle/duplicate handling, previewable imports, incremental indexing/performance, and measured desktop/mobile sync behavior. Wall-clock order is not causal order; notes not yet synchronized cannot be acted on. Cross-file writes and offline concurrent operations have no global transaction guarantee.
