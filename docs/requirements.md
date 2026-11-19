# Requirements

Preview 0.1.2 implements manual/open timer records without private metadata blocks, a local device-name suggestion, nested/flat property mappings, per-device or optional all-device closure, separate Timer/Status settings and current-note sidebar actions. Timer state is reconstructed from Markdown rather than saved locally. Older preview drafts remain explicitly recoverable. Decisions and limits are recorded in [architecture](architecture.md); automated and manual validation are distinguished in [testing](testing.md). Requirements below also describe later work.

## Confirmed direction

Build an independent Obsidian plugin named **Track Record**, with the subtitle **Time tracking & status history for your notes.** Capture time intervals and note-level status history as linked Markdown records. General note creation remains with Templater, and planned record/relations queries remain read-only consumers in Bases Excerpts.

## Time records

- Explicitly start and stop work for a target note, with visible running state.
- Support manual entries for work outside Obsidian and correction of existing entries.
- Retain start/end timestamps with timezone offsets; calculate durations from instants.
- Distinguish open, closed and interrupted intervals; never fabricate a stop time on restart.
- Validate end-before-start values. Present overlaps rather than silently removing or summing them as unique work time.
- Define single versus concurrent timers before implementing timer commands.

## Status records

- Preserve each transition, including repeated transitions such as open → active → paused → active.
- Store the subject, timestamp and resulting status. Decide whether the previous status is required or derived.
- Separate effective time from observed time when detecting changes outside plugin commands.
- Do not treat the first observed status as a known creation event or reconstruct missing intermediate changes.
- Decide how explicit commands and direct property edits interact before enabling automatic capture.
- Keep existing `status` properties until a projection and migration policy is agreed.

## Records and relations

- Records remain readable/editable Markdown without the plugin.
- Provide stable record identity and configurable links to the subject note.
- The initial profile uses `contexts` for subject links, `time_start`/`time_end` for intervals and tags for record types; `projects` is a planned relation property.
- Support project-level queries through relations, accounting for multiple parents, cycles and duplicate records. Agree ownership of aggregation with Bases Excerpts before implementation.
- Do not introduce a mandatory `type` property when record-type tags already provide classification.
- Preserve record identity across renames, corrections and sync. Define subject identity and rename handling explicitly.

## Compatibility and write safety

- Target desktop and mobile using supported Obsidian APIs. Compatibility remains unverified until tested.
- By default, close only timer records whose device matches the local name. An explicit reset-all option may close other-device records visible in the vault. Never write a shared aggregate timer-state file.
- Do not silently pick a winner for conflicting records or simultaneous status transitions.
- Handle note and record synchronization arriving in either order.
- Use guarded writes and preserve user edits; avoid event feedback loops with other metadata plugins.
- Do not modify the source note from a formula evaluation.
- Do not change activation, workspace state or existing records during setup.

## Acceptance scenarios for implementation

1. A manually recorded interval remains readable without the plugin and yields the expected duration across a timezone/DST change.
2. Re-entering a status creates another event rather than overwriting the first occurrence.
3. Interrupted and offline sessions show uncertainty rather than invented work.
4. Renaming a subject preserves links and attribution.
5. A record referenced through multiple project paths is counted once; cycles terminate.
6. Concurrent devices and delayed sync do not silently duplicate or overwrite history.
7. Direct property edits follow the documented capture policy without recursive writes.
8. An ordinary note, unrelated metadata and existing Tasks checkbox semantics remain intact.

Automated coverage now includes timestamp/DST handling, repeated statuses, guarded writes, timer recovery, simultaneous device drafts, subject renames and preservation of source notes. Recursive project aggregation is not implemented. Live desktop/Android checks remain pending.
