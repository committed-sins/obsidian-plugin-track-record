# Track Record for Obsidian

*Time tracking & status history for your notes.*

Track Record is a planned Obsidian plugin for recording work intervals and note status transitions as linked Markdown records in your vault.

**Status: concept repository. No working plugin, release, or vault deployment yet.**

## Intended behavior

- Start and stop work intervals for notes; support manual entries and corrections.
- Record note status transitions, preserving repeated visits to the same status.
- Keep records as ordinary Markdown notes, with YAML properties, timestamps and links.
- Use configurable record folders, tags and property names. The initial Continuum concept uses `records/`, record-type tags, `contexts`, `time_start` and `time_end`.
- Keep work duration distinct from elapsed time in a status.
- Make records available to native Bases and planned read-only records/relations functions in Bases Excerpts.
- Plan for desktop and mobile, including interrupted timers and synchronized vaults.

The provisional plugin ID is `track-record`; it is not registered with the Community Plugins directory. The name and subtitle were confirmed on 2026-11-18. No exact name/ID collision was found in the community registry or the targeted GitHub repository search that day; this is not a trademark clearance.

## Boundaries

Track Record concerns note-level work intervals and status history. Task Trace concerns the history of individual Markdown checkbox tasks. Revision Marks concerns revisions, and Issue Bridge connects external issues. Track Record does not require TaskNotes or replace those plugins.

Templater continues to handle general note creation and schema helpers. Bases Excerpts' planned formula functions read records; formulas must not create or modify them. Any migration from existing time/status properties or Templater workflows needs a separate preview and explicit application.

## Design documents

- [Requirements](docs/requirements.md)
- [Data model and architecture](docs/architecture.md)
- [Implementation roadmap](docs/roadmap.md)
- [Existing plugins and naming research](docs/research.md)

Record layout, transition capture policy, timer concurrency and current-status projection remain design decisions. Examples in these documents are proposals, not an implemented or frozen format.

## License

[MIT](LICENSE)
