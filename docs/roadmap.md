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

## 2. Status capture and history

- [x] Add explicit status-record commands and a note history view; source-note projection remains deferred.
- Add optional property observation only after defining effective/observed times and projection ownership.
- Detect ambiguous transitions, concurrent changes and delayed sync.
- Validate note renames, record corrections, duplicate delivery and metadata-plugin interactions.

## 3. Queries and migration

- Agree record and relations integration with Bases Excerpts.
- Validate project rollups, repeated statuses, overlapping intervals, multiple parents and cycles.
- Prepare a dry-run migration from existing time/status data and former Templater plans.
- Keep removal of `status` or renaming `logs` to `records` as separately reviewed migration steps.

## 4. Validation and release

- [x] Deploy development preview 0.1.0 to the authorized Test vault (2026-11-19), preserving activation and settings.
- Let the user validate desktop and Android behavior, including interruption, offline use and sync ordering.
- Measure performance on realistic record counts.
- Prepare a first beta and later evaluate Community Plugins submission.

Previews are development builds. Test-vault deployment and user validation must precede the first release. Do not tag or publish based on the manifest version alone. The user handles Community Plugins submission after release approval.
