# Track Record for Obsidian

*Time tracking & status history for your notes.*

Track Record records work intervals and note status events as linked Markdown records in your vault.

**Development preview 0.1.5. Test-vault evaluation comes before the first release. No public release or Community Plugins submission yet.**

## Preview features

- Start/stop a timer across devices for the current optional user. Without a configured user, only unassigned timers are closed. Starting closes matching open timers at the replacement's start time.
- Add manual time records and explicit status events in separate dialogs. Ctrl+Enter (Cmd+Enter on macOS) saves and closes only on success.
- Choose subject notes with Obsidian's fuzzy note picker; remove individual selections. The status input suggests distinct values from all readable status records, using their configured property paths, while accepting new values.
- Write Markdown notes in a larger field, insert note links with the native picker and preview them. New records always include a level-two notes heading (Settings: **Notes heading**, default **Notes**) for section extraction.
- Switch the history view between Timer and Status, then choose the selected note or all notes. Inspect work totals, record links and warnings about overlaps, duplicate IDs and tied status times.
- Reconstruct running timers from Markdown after reload/shutdown, without a persistent local timer list.
- Configure Timer and Status separately: folder, identifying tag and filename format. They can share a folder. Earlier property/tag mappings are retained in plugin settings, not in the Markdown notes.

Commands are prefixed **Track Record** in the command palette: **Start timer for active note**, **Stop timer**, **Add manual time record for active note**, **Record status for active note**, **Open note history and timer**, and **Recover legacy timer** (only for local drafts from older previews). The ribbon/status-bar item opens history.

New timestamps are saved in UTC (`Z`). Manual time and status dialogs use native local date/time pickers; history shows local time, with the stored timestamp available on hover. Older timestamps with explicit offsets remain readable without migration. Nonexistent local times during the spring clock change are rejected. During the repeated autumn hour the local picker uses the earlier occurrence; edit the saved timestamp with an explicit offset if the later occurrence is intended. Manual intervals require an end after the start. Correct saved records by opening their Markdown note, editing properties/text and refreshing history.

**Source notes remain unchanged.** Recording a status does not update the source note's `status` property. The preview has no automatic property observer, source-status projection, status-duration formulas or project aggregation. Work duration is separate from time spent in a status.

Both default folders are `records/track-record`. New records have a type tag, creation timestamp, subject wikilink list and ordinary time/status properties. No record ID/UUID or `track_record` metadata is written. Existing records remain readable without rewriting them; existing source-note IDs are read, never assigned or changed. A note's path identifies it internally; the plugin does not promise extra sync collision semantics beyond ordinary vault notes.

### Optional user and nested properties

**Current user → User name** is an optional local setting. Use the same name across your devices. A configured user closes only that exact user's open timers; no configured user closes only timers without a user. Empty/null/missing user values are unassigned. The old device name and reset-all flag are ignored, never converted into a user. There is no access-control claim: users with vault write access can edit a timer's note directly.

Property settings support dot notation, with these timer defaults for new configurations:

```yaml
record:
  user: Alice
  start: "2026-11-19T09:00:00+01:00"
  end: null
```

Configure `record.user`, `record.start` and `record.end`, or flat names such as `user`, `time_start` and `time_end`. With no configured user the user property is omitted. Status also defaults to `record.start` as its effective time but has no user/device field. Overlapping paths and reserved/prototype keys are rejected. Existing configured paths are preserved rather than silently migrated.

A timer is open when its configured end property is missing, `null`, empty or whitespace-only. Start and Stop re-read records and match the current optional user, including unassigned-to-unassigned only. Starting writes an open note immediately; stopping updates its end using a guarded `Vault.process` write, preserving body, comments and unrelated fields. If a selected timer cannot be closed, no replacement is started. Candidates are preflighted, but writes across several notes are not atomic: an I/O failure can leave some already closed. Timers not yet synchronized are invisible to the scan.

Timer and Status have separate subject-link settings, both defaulting to `contexts`. `projects`, `project` or nested property paths are valid alternatives. Values are written as lists; reading also accepts one scalar wikilink. The manual dialog accepts one note path per line. Multiple Timer links assign the full interval to each target while counting it once globally; do not add per-note/project subtotals as if they were disjoint work. Multiple Status links assert the same status for every listed target, explicitly described by the dialog. Native link aliases are supported and duplicate targets are ignored.

Timer and Status settings use separate **Save in folder** (vault-relative filesystem path, with folder suggestions) and **Identify by tag** (Obsidian tag) controls. A slash in a tag denotes a tag hierarchy, not a folder. The settings accept an optional leading `#`; YAML stores a normal `tags` list without it. Tags are case-insensitive.

The editable default filename base for both kinds is `{type} - {timestamp}`. The plugin always appends `.{hash}.md`:

```text
Timer - 2026-11-20T08-00-00Z.a1b2c3.md
Status - 2026-11-20T08-00-00Z.d4e5f6.md
```

`{timestamp}` is UTC to seconds, without milliseconds; colons become hyphens for Windows-safe names. `{date}` is its UTC calendar date. `{type}` is Timer or Status. The fixed suffix is six random hexadecimal characters, not a content hash. It is never expanded into a UUID. A filename collision is reported without overwriting or adding identity properties. Retry as a new record or resolve the note collision. Previous trailing `{hash}` patterns are interpreted as the new fixed suffix. New timestamp properties use UTC and retain millisecond precision for timer Start/Stop; manual inputs use seconds.

Running timers are ordinary open Markdown records; no new local draft/session state is stored. Reloading or switching devices does not invent an end time. Idle/sleep time is not automatically subtracted; the interval ends only when explicitly stopped/switched or edited. The previous preview's local draft, if present, is preserved and requires explicit **Recover legacy timer** or discard before new timers can start. An interrupted legacy save retries its exact original bytes and path.

Devices create independent records. Overlaps are flagged rather than merged; totals are withheld if scanned records overlap, have duplicate IDs or cannot be parsed. There is no cross-device timer lock or exactly-once guarantee for separate manual submissions. Tied status events have no inferred causal order.

Subject relationships come from wikilinks. Native link updates remain Obsidian's responsibility. Duplicate source IDs known to the metadata cache block recording. Retained profiles in plugin settings must be kept/synchronized if older records use customized tags or property names. The current-user setting stays local; enter the same name on your other devices. Vault file events refresh the timer list after a short debounce; clock ticks do not rescan files. Large-vault and live mobile behavior remain unverified.

## Build and test deployment

Requires Node.js 22+:

```sh
npm ci
npm run check
node scripts/deploy.mjs /path/to/Test
```

Artifacts are built into `dist/`. Deployment accepts only a vault named `Test`, copying `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/track-record`. Settings, activation, workspace and records are preserved. Enable/reload manually in Test.

TypeScript, Allman checks, build and 57 automated tests cover the core, real plugin methods against a simulated Obsidian boundary, sidebar controls and deployment. **They do not establish live desktop or Android behavior.** See the [manual test guide](docs/testing.md).

## Direction beyond the preview

- Start and stop work intervals for notes; support manual entries and corrections.
- Record note status transitions, preserving repeated visits to the same status.
- Keep records as ordinary Markdown notes, with YAML properties, timestamps and links.
- Use configurable record folders, tags and property names. The initial Continuum concept uses `records/`, record-type tags, `contexts`, `time_start` and `time_end`.
- Keep work duration distinct from elapsed time in a status.
- Make records available to native Bases and planned read-only records/relations functions in Bases Excerpts.
- Plan for desktop and mobile, including interrupted timers and synchronized vaults.

The plugin ID is `track-record`; it is not registered with the Community Plugins directory. The name and subtitle were confirmed on 2026-11-18. No exact name/ID collision was found in the community registry or the targeted GitHub repository search that day; this is not a trademark clearance.

## Boundaries

Track Record concerns note-level work intervals and status history. Task Trace concerns the history of individual Markdown checkbox tasks. Revision Marks concerns revisions, and Issue Bridge connects external issues. Track Record does not require TaskNotes or replace those plugins.

Templater continues to handle general note creation and schema helpers. Bases Excerpts' planned formula functions read records; formulas must not create or modify them. Any migration from existing time/status properties or Templater workflows needs a separate preview and explicit application.

## Design documents

- [Requirements](docs/requirements.md)
- [Data model and architecture](docs/architecture.md)
- [Implementation roadmap](docs/roadmap.md)
- [Manual testing and release gate](docs/testing.md)
- [Existing plugins and naming research](docs/research.md)

The preview's schema/capture decisions and remaining work are recorded in the architecture and roadmap. No source-status removal, existing-folder rename, automatic migration, analytics or network access is implemented.

## License

[MIT](LICENSE)
