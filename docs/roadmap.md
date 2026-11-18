# Implementation roadmap

## 0. Project setup

- [x] Confirm name and subtitle.
- [x] Check the community registry and targeted repository search for exact name collisions on 2026-11-18.
- [x] Prepare requirements, architecture, research and contributor instructions.
- [ ] Resolve the open schema and capture-policy decisions before implementing automatic writes.

## 1. Manual record MVP

- Create the TypeScript plugin scaffold and build tooling with Allman formatting.
- Implement configurable record folder, tag/property mappings and subject selection.
- Create manual time and status records with stable IDs and validation.
- Add explicit start/stop commands and device-local interrupted-session recovery after defining timer concurrency.
- Implement focused tests for timestamp handling, repeated statuses, guarded writes and recovery.

## 2. Status capture and history

- Add status-change commands and a note history view.
- Add optional property observation only after defining effective/observed times and projection ownership.
- Detect ambiguous transitions, concurrent changes and delayed sync.
- Validate note renames, record corrections, duplicate delivery and metadata-plugin interactions.

## 3. Queries and migration

- Agree record and relations integration with Bases Excerpts.
- Validate project rollups, repeated statuses, overlapping intervals, multiple parents and cycles.
- Prepare a dry-run migration from existing time/status data and former Templater plans.
- Keep removal of `status` or renaming `logs` to `records` as separately reviewed migration steps.

## 4. Validation and release

- Deploy a development preview to a designated test vault only when authorized.
- Let the user validate desktop and Android behavior, including interruption, offline use and sync ordering.
- Measure performance on realistic record counts.
- Prepare a first beta and later evaluate Community Plugins submission.

No runtime, deployment or release is included in the initial concept setup.
