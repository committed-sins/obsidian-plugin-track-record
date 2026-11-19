# Track Record for Obsidian

*Time tracking & status history for your notes.*

Track Record records work intervals and note status events as linked Markdown records in your vault.

**Development preview 0.1.0. Test-vault evaluation comes before the first release. No public release or Community Plugins submission yet.**

## Preview features

- Start/stop a timer for the active Markdown note: one timer per vault and device.
- Add manual time records and explicit status events, including repeated visits to a status.
- Open the history sidebar for the selected note or all records. Inspect work totals, record links and warnings about overlaps, duplicate IDs and tied status times.
- Recover interrupted timers after reload/shutdown by choosing the actual end time. Pending saves retry the same UUID and content.
- Configure the record folder, tags and property names. Earlier records retain their mapping in a versioned metadata block.

Commands are prefixed **Track Record** in the command palette: **Start timer for active note**, **Stop timer**, **Add manual time record for active note**, **Record status for active note**, **Open note history and timer**, and **Recover interrupted timer**. The ribbon/status-bar item opens history.

Use ISO timestamps with an explicit timezone, e.g. `2026-11-19T09:00:00+01:00`. Manual intervals require an end after the start. Correct saved records by opening their Markdown note, editing properties/text and refreshing history.

**Source notes remain unchanged.** Recording a status does not update the source note's `status` property. The preview has no automatic property observer, source-status projection, status-duration formulas or project aggregation. Work duration is separate from time spent in a status.

The default folder is `records/track-record`. Each record has a UUID, type tag, single full-path subject link and `track_record` metadata containing schema version, session, optional existing subject ID and property mappings. Existing note IDs are read, never assigned or changed.

Running timers and pending timer-save intent use Obsidian's vault-specific, device-local storage, not shared plugin `data.json`. A work record is created only on explicit stop/recovery. App storage loss can lose an unfinished local draft; completed Markdown records are independent. Idle/sleep time is not automatically subtracted from an explicitly started timer.

Devices create independent records. Overlaps are flagged rather than merged; totals are withheld if scanned records overlap, have duplicate IDs or cannot be parsed. There is no cross-device timer lock or exactly-once guarantee for separate manual submissions. Tied status events have no inferred causal order.

String subject IDs help with renames. Duplicate IDs known to the metadata cache block recording. For notes without IDs, recovery after an offline rename can require restoring the original path. Native wikilink updates remain Obsidian's responsibility. History refresh is explicit; large-vault and live mobile behavior remain unverified.

## Build and test deployment

Requires Node.js 22+:

```sh
npm ci
npm run check
node scripts/deploy.mjs /path/to/Test
```

Artifacts are built into `dist/`. Deployment accepts only a vault named `Test`, copying `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/track-record`. Settings, activation, workspace and records are preserved. Enable/reload manually in Test.

TypeScript, Allman checks, build and 26 automated tests pass. Tests exercise the core, real plugin methods against a simulated Obsidian boundary, and deployment. **They do not establish live desktop or Android behavior.** See the [manual test guide](docs/testing.md).

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
