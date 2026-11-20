# Implementation roadmap

## 0. Project setup

- [x] Confirm name and subtitle.
- [x] Check the community registry and targeted repository search for exact name collisions on 2026-11-18.
- [x] Prepare requirements, architecture, research and contributor instructions.
- [x] Choose a versioned Markdown schema, one local timer and explicit-only status capture for the preview. Automatic observation remains deferred.

## 1. Manual record MVP

- [x] Create the TypeScript plugin scaffold and build tooling with Allman formatting.
- [x] Implement configurable record folder, tag/property mappings and subject selection.
- [x] Create manual time and status records with stable IDs and validation.
- [x] Add explicit start/stop commands and device-local interrupted-session/pending-save recovery.
- [x] Add note/all-records history with work totals and ambiguity warnings.
- [x] Pass core, plugin-boundary and deployment tests.

## Preview 0.1.1 refinements

- [x] Remove private metadata from new records; read legacy records and pending saves without rewriting them.
- [x] Separate Timer/Status folders, tags and user-defined filename formats; clarify tag hierarchy versus directory paths.
- [x] Default to Timer/Status, UTC seconds without milliseconds and a short collision-safe ID suffix.
- [x] Add current-note Start/Stop, a live running-timer card and a separate history scope to the sidebar.
- [x] Close the previous timer on this device when starting a replacement, blocking replacement on save failure.
- [x] Extend coverage to 35 tests, including upgrade recovery and sidebar controls.

## Preview 0.1.2 device and open-record model

- [x] Suggest and store only a device-local name; keep it separate from synchronized plugin settings.
- [x] Support nested/flat property paths, defaulting to timer.device/start/end; Status remains device-independent.
- [x] Write open timer notes at Start and reconstruct active timers from them after reload.
- [x] Select missing/null/empty end fields by device name or explicit reset-all toggle; preflight and guard every end-field write.
- [x] Preserve YAML comments, unrelated fields and bodies while closing records.
- [x] Retain explicit legacy local-draft recovery without creating new local timer state.
- [x] Extend automated coverage to 45 tests.

## 2. Status capture and history

### Preview 0.1.3 refinements

- [x] Replace device/reset-all ownership with optional current-user matching; no user closes only unassigned timers.
- [x] Default Timer/Status effective times to record.start, Timer end/user to record.end and record.user.
- [x] Fixed .{hash}.md suffix outside the editable base; no UUID/record-ID property or suffix expansion.
- [x] Separate subject settings, multiple targets, full per-target duration and single global counting.
- [x] Pass 51 automated tests; keep existing records/drafts without automatic migration.

- [x] Add explicit status-record commands and a note history view; source-note projection remains deferred.
- Add optional property observation only after defining effective/observed times and projection ownership.
- Detect ambiguous transitions, concurrent changes and delayed sync.
- Validate note renames, record corrections, duplicate delivery and metadata-plugin interactions.

## 3. Queries and migration

- Agree record and relations integration with Bases Excerpts.
- Validate project rollups, repeated statuses, overlapping intervals, multiple parents and cycles.
- Prepare a dry-run migration from existing time/status data and former Templater plans.
- Keep removal of `status` or renaming `logs` to `records` as separately reviewed migration steps.

### Preview 0.1.4 refinements

- [x] Save new timestamps in UTC; show and enter local time using native date/time pickers.
- [x] Remove redundant view heading, group note actions and expose persistent history scope buttons with refresh icon.
- [x] Pass 52 tests and inspect the bottom-pane layout and native calendar in Test. Mobile and full user acceptance remain pending.

## 4. Validation and release

- [x] Deploy development preview 0.1.0 to the authorized Test vault (2026-11-19), preserving activation and settings.
- Let the user validate desktop and Android behavior, including interruption, offline use and sync ordering.
- Measure performance on realistic record counts.
- Prepare a first beta and later evaluate Community Plugins submission.

Previews are development builds. Test-vault deployment and user validation must precede the first release. Do not tag or publish based on the manifest version alone. The user handles Community Plugins submission after release approval.
