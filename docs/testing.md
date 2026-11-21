# Testing and release gate

## Automated checks

Run `npm ci` followed by `npm run check` with Node.js 22+. The check includes strict TypeScript, the official Obsidian ESLint recommended rules, an AST-based Allman check, browser/CJS bundling and 66 tests. `npm run format` uses TypeScript formatting plus Allman placement for functions/classes; generated bundles and third-party code are excluded.

Core tests cover YAML round-trips, configurable mappings, invalid dates/offsets, daylight-saving transitions, repeated statuses, equal-time ambiguity, overlaps, duplicate IDs, conflicting destinations, exact retries, interrupted local timers, failed writes and independent device drafts.

Plugin-boundary tests run actual plugin methods and dialog callbacks against a simulated Obsidian app. They verify source-note preservation, rename attribution, failed manual-save retries, duplicate subject IDs and invalid-settings write blocking. Deployment tests check preservation of settings, activation and workspace and rejection of production-vault paths/wrong artifacts.

These tests do not render Obsidian's actual UI or establish filesystem/sync behavior on real mobile devices.

## Deployment

After checks pass, deploy only to the Test vault:

```sh
node scripts/deploy.mjs /path/to/Test
```

Only `main.js`, `manifest.json` and `styles.css` are copied. Enable/reload manually in Test. Deployment does not change existing data, notes, settings, activation or workspace configuration.

## Manual desktop checklist — user testing pending

1. In **Test**, enable Track Record under Community plugins (reload if already enabled). Open an ordinary Markdown note. Enabling/opening alone must not create records.
2. Run **Track Record: Start timer for active note**. Wait briefly, run **Stop timer**, and open **Open note history and timer**. Check duration and the generated record under `records/track-record`; the source note must be unchanged.
3. Add a manual interval using the native local date/time pickers. Confirm saved properties use UTC and history shows the same local time. Try an end before start and a nonexistent date: the dialog should remain open and show an error. Then save a valid interval with optional text.
4. Record `active`, `paused`, `active` at increasing effective times. Confirm three separate records. Source `status` remains unchanged. Record two different statuses at the same instant and check the ambiguity warning.
5. Create overlapping time records, including on different notes. History must withhold totals and show a warning. Correct the intervals in Markdown and refresh. Invalid records must produce visible errors.
6. Start a timer: an open Markdown record should exist immediately. Disable/re-enable or reopen Obsidian; the timer should be reconstructed from that note and Stop should set its end. For a draft left by an older preview only, use **Recover legacy timer** explicitly.
7. Rename/move a subject while retaining its string `id`, then stop the timer. Confirm attribution. Without an ID, test a live rename with native link updates; an offline rename can require restoring the old path. Duplicate note IDs should block new recording once indexed.
8. In settings, use different folders/tags/formats for Timer and Status, then the same folder. Check folder suggestions and filename previews. Use `#record/time` as a tag input and confirm YAML stores `record/time`. Earlier records should remain readable using retained profiles in plugin settings; no prior record is migrated.
9. Use sidebar Start/Stop for the current note. Switch notes and start another timer: the previous local timer must end at the exact new start time. Check the running clock updates each second and remains visible while browsing another note. Selecting All notes must not change the current-note action target.
10. Check new filenames use UTC seconds, a short suffix and the configured Timer/Status patterns. New frontmatter must not include `track_record`. Existing 0.1.0 records and pending timer saves should remain readable/recoverable with their original content.
11. Set the same optional user on two devices. The local name must persist without appearing as a name value in shared settings. No device-name suggestion remains. Clear the user and confirm assigned users' timers stay open; only unassigned timers close. Existing device names and reset-all flags cannot change this behavior.
12. Configure nested record.user/start/end, then flat alternatives. Test missing, null, empty and whitespace-only ends. Status defaults to record.start and has no user/device field. Add comments, extra YAML fields and body text to an open timer, then Stop: retain them.
13. Create multiple same-user and other-user timers. Start/Stop must close exact owner matches only. A future start or conflicting edit must prevent a replacement. Cross-file writes can partially finish on an I/O failure.
14. Set a literal filename base without placeholders. The final name must still end in six hexadecimal characters as Base.abcdef.md; no new id/track_record property is written. A collision reports an error without expanding the suffix or overwriting.
15. Configure Timer subjects as projects and Status subjects as contexts. Select several notes in each dialog. Check every linked note view, global time counted once, full duration per target and the explicit description that a multi-target status applies to all listed notes. Check aliases and duplicate-target handling.
16. Check the history toolbar has two persistent scope buttons, exactly one visibly selected, and a refresh icon with a tooltip. Check a wide bottom pane and a narrow sidebar. No extra Track Record heading should appear.


17. Check Ctrl/Cmd+Enter: valid inputs save once and close, invalid inputs and write errors keep the dialog open. Retrying must use the original submission. Select multiple subjects, remove them and ensure at least one is required. Records must not appear in the subject picker.
18. Enter repeated status values, including a custom nested status property. The editable dropdown must offer distinct existing values across all readable records and accept a new value.
19. Set Notes heading to Work details. Enter Markdown links and insert a vault link; preview and save. Verify the exact Markdown under `## Work details`, with no source-note edits. Check section extraction with Bases Excerpts manually. Old notes must remain unchanged.
20. Switch Timer/Status modes: only matching actions, records and summaries should appear. Changing type/scope must retain the selected subject. A timer keeps running while Status is shown.

Desktop spot check (2026-11-20, preview 0.1.4): viewed the real bottom pane in Test, confirmed the compact toolbar and opened the native date/time calendar. Closed the dialog without creating a record. Mobile, narrow-pane rendering and the full manual matrix remain pending.

Desktop spot check (2026-11-20, preview 0.1.5): switched to Status while an existing timer kept running; opened the fuzzy subject picker and the editable status dropdown with an existing value. Ctrl+Enter with an empty status kept the dialog open and displayed validation. Markdown preview rendered the notes heading and a link. Discarded the draft and returned to the original note without creating a record. Successful keyboard save, multiple subjects and custom headings are covered at the simulated boundary; full live acceptance, Bases Excerpts section extraction and mobile remain pending.

21. With an owned timer running, close Test normally, reopen it and confirm the reminder identifies the quit boundary. Continue must leave Markdown unchanged. Repeat and end at the proposed timestamp; verify the exact end and unchanged source note. Try a custom end, including an invalid end before start.
22. For a crash fallback, allow a heartbeat before terminating the app without its quit callback. Reopen: the proposed timestamp must be explicitly labelled approximate. Plugin disable/re-enable must say last-active/plugin-stopped rather than claim the whole app closed.
23. Dismiss a reminder and restart: it must return with the original pending boundary, or reopen via the review command. Complete the timer on another synced device before reopening: it must not prompt or overwrite that end. New/other-user timers must remain untouched.

## Mobile and synchronization — pending

- Repeat commands, dialogs and recovery on Android; use command palette/ribbon where no status bar is available.
- Interrupt in the background and terminate/reopen. Open records remain authoritative; no shutdown end time is inferred.
- Run timers on two devices with the same user and another with a different user. Sync records in either order and check filtering. No configured user leaves assigned users untouched. Only synchronized records can be acted on.
- Modify a pending destination before retry: content must not be overwritten.
- Check delayed metadata/link resolution and malformed/conflicting records. The preview cannot capture changes it never observed or guarantee cross-device exactly-once manual submissions.

## First release

Test deployment and user validation must precede the first release. Do not tag/publish 0.1.0 merely because the manifest contains that development version. The user approves the release and performs Community Plugins submission; temporary submission errors do not change this order.

Automated interruption coverage includes quit and unload observations, crash fallback, dismissed decisions across restarts, late sync, end/start changes, ownership changes, invalid end, I/O failure, first-install behavior and malformed local state. Real app shutdown and mobile remain part of user acceptance.
