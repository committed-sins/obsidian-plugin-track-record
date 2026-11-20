# Requirements

Preview 0.1.3 uses optional user ownership across devices, record.* defaults, fixed short filename suffixes without ID properties, separate Timer/Status subject fields and multiple linked targets. No configured user closes only unassigned timers. Timer state is reconstructed from Markdown. Older preview drafts remain explicitly recoverable. See [architecture](architecture.md) and [testing](testing.md); later requirements below remain design work.

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
- Use ordinary note paths for new record identity and configurable subject links; no special identity properties or UUID filenames.
- The initial profile uses `contexts` for subject links, `time_start`/`time_end` for intervals and tags for record types; `projects` is a planned relation property.
- Support project-level queries through relations, accounting for multiple parents, cycles and duplicate records. Agree ownership of aggregation with Bases Excerpts before implementation.
- Do not introduce a mandatory `type` property when record-type tags already provide classification.
- Preserve record identity across renames, corrections and sync. Define subject identity and rename handling explicitly.

## Compatibility and write safety

- Target desktop and mobile using supported Obsidian APIs. Compatibility remains unverified until tested.
- Close only records matching the optional current user. No configured user closes only unassigned timers. Device names and old reset-all flags must not bypass this rule. Never write a shared aggregate timer-state file.
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
