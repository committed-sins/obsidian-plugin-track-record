# Track Record for Obsidian

*Time tracking & status history for your notes.*

Track Record records work intervals and note status events as linked Markdown records in your vault.

**Development preview 0.1.2. Test-vault evaluation comes before the first release. No public release or Community Plugins submission yet.**

## Preview features

- Start/stop a timer for the current note directly in the sidebar. A start closes all matching open timer notes at the new start time: normally this device only, optionally every device currently present in the vault.
- Add manual time records and explicit status events, including repeated visits to a status.
- Open the history sidebar for the selected note or all records. Inspect work totals, record links and warnings about overlaps, duplicate IDs and tied status times.
- Reconstruct running timers from Markdown after reload/shutdown, without a persistent local timer list.
- Configure Timer and Status separately: folder, identifying tag and filename format. They can share a folder. Earlier property/tag mappings are retained in plugin settings, not in the Markdown notes.

Commands are prefixed **Track Record** in the command palette: **Start timer for active note**, **Stop timer**, **Add manual time record for active note**, **Record status for active note**, **Open note history and timer**, and **Recover legacy timer** (only for local drafts from older previews). The ribbon/status-bar item opens history.

Use ISO timestamps with an explicit timezone, e.g. `2026-11-19T09:00:00+01:00`. Manual intervals require an end after the start. Correct saved records by opening their Markdown note, editing properties/text and refreshing history.

**Source notes remain unchanged.** Recording a status does not update the source note's `status` property. The preview has no automatic property observer, source-status projection, status-duration formulas or project aggregation. Work duration is separate from time spent in a status.

Both default folders are `records/track-record`. Records have a UUID, type tag, creation timestamp, single subject wikilink and ordinary time/status properties. They contain no `track_record` block or private subject/session metadata. Existing records remain readable without rewriting them. Existing source-note IDs are read, never assigned or changed.

### Device and nested properties

**This device → Device name** is saved only in Obsidian's vault-specific local storage. It is suggested once from the desktop hostname. Where a hostname is unavailable (including mobile), a platform label plus a short suffix is used. Edit the suggestion as desired; use a distinct name for each device. Devices with the same name are intentionally treated as the same owner. Renaming this setting does not rename device values in existing timer notes.

Property settings support dot notation, with these timer defaults for new configurations:

```yaml
timer:
  device: My desktop
  start: "2026-11-19T09:00:00+01:00"
  end: null
```

Configure `timer.device`, `timer.start` and `timer.end`, or flat names such as `device`, `time_start` and `time_end`. Nested subject/status properties are also supported. Overlapping paths and reserved/prototype keys are rejected. Status retains its separate effective-time property (`time_start` by default) and has no device field.

A timer is open when its configured end property is missing, `null`, empty or whitespace-only. Start and Stop re-read records and filter `(device === thisDevice || resetAllTimersActive) && endIsOpen`. **Reset all active timers** is off by default. Starting writes an open note immediately; stopping updates its end field using a guarded `Vault.process` write, preserving body, comments and unrelated fields. If a selected timer cannot be closed, no replacement is started. All candidates are preflighted, but writes across several notes are not one atomic transaction: an I/O failure can leave some already closed. Timers on devices not yet synchronized are necessarily invisible to this scan.

Timer and Status settings use separate **Save in folder** (vault-relative filesystem path, with folder suggestions) and **Identify by tag** (Obsidian tag) controls. A slash in a tag denotes a tag hierarchy, not a folder. The settings accept an optional leading `#`; YAML stores a normal `tags` list without it. Tags are case-insensitive.

The default filename format for both kinds is `{type} - {timestamp} - {hash}`:

```text
Timer - 2026-11-19T08-00-00Z - a1b2c3.md
Status - 2026-11-19T08-00-00Z - d4e5f6.md
```

`{timestamp}` is UTC to seconds, without milliseconds; colons become hyphens for Windows-safe names. `{date}` is its UTC calendar date. `{type}` is Timer or Status. `{hash}` is a six-character UUID prefix (not a cryptographic content hash); it expands if a filename already exists with different content. Each type can use its own pattern. Include `{hash}` and omit the `.md` extension. Ordinary timestamp properties retain their full precision and timezone.

Running timers are ordinary open Markdown records; no new local draft/session state is stored. Reloading or switching devices does not invent an end time. Idle/sleep time is not automatically subtracted; the interval ends only when explicitly stopped/switched or edited. The previous preview's local draft, if present, is preserved and requires explicit **Recover legacy timer** or discard before new timers can start. An interrupted legacy save retries its exact original bytes and path.

Devices create independent records. Overlaps are flagged rather than merged; totals are withheld if scanned records overlap, have duplicate IDs or cannot be parsed. There is no cross-device timer lock or exactly-once guarantee for separate manual submissions. Tied status events have no inferred causal order.

Subject relationships come from wikilinks. Native link updates remain Obsidian's responsibility. Duplicate source IDs known to the metadata cache block recording. Retained profiles in plugin settings must be kept/synchronized if older records use customized tags or property names. Device names stay local regardless of settings sync. Vault file events refresh the timer list after a short debounce; clock ticks do not rescan files. Large-vault and live mobile behavior remain unverified.

## Build and test deployment

Requires Node.js 22+:

```sh
npm ci
npm run check
node scripts/deploy.mjs /path/to/Test
```

Artifacts are built into `dist/`. Deployment accepts only a vault named `Test`, copying `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/track-record`. Settings, activation, workspace and records are preserved. Enable/reload manually in Test.

TypeScript, Allman checks, build and 45 automated tests cover the core, real plugin methods against a simulated Obsidian boundary, sidebar controls and deployment. **They do not establish live desktop or Android behavior.** See the [manual test guide](docs/testing.md).

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
