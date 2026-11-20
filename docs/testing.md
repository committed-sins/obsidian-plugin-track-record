# Testing and release gate

## Automated checks

Run `npm ci` followed by `npm run check` with Node.js 22+. The check includes strict TypeScript, an AST-based Allman check, browser/CJS bundling and 51 tests. `npm run format` uses TypeScript formatting plus Allman placement for functions/classes; generated bundles and third-party code are excluded.

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
3. Add a manual interval with timezone timestamps. Try an end before start and a nonexistent date: the dialog should remain open and show an error. Then save a valid interval with optional text.
4. Record `active`, `paused`, `active` at increasing effective times. Confirm three separate records. Source `status` remains unchanged. Record two different statuses at the same instant and check the ambiguity warning.
5. Create overlapping time records, including on different notes. History must withhold totals and show a warning. Correct the intervals in Markdown and refresh. Invalid records must produce visible errors.
6. Start a timer: an open Markdown record should exist immediately. Disable/re-enable or reopen Obsidian; the timer should be reconstructed from that note and Stop should set its end. For a draft left by an older preview only, use **Recover legacy timer** explicitly.
7. Rename/move a subject while retaining its string `id`, then stop the timer. Confirm attribution. Without an ID, test a live rename with native link updates; an offline rename can require restoring the old path. Duplicate note IDs should block new recording once indexed.
8. In settings, use different folders/tags/formats for Timer and Status, then the same folder. Check folder suggestions and filename previews. Use `#record/time` as a tag input and confirm YAML stores `record/time`. Earlier records should remain readable using retained profiles in plugin settings; no prior record is migrated.
9. Use sidebar Start/Stop for the current note. Switch notes and start another timer: the previous local timer must end at the exact new start time. Check the running clock updates each second and remains visible while browsing another note. Toggling All notes must not change the current-note action target.
10. Check new filenames use UTC seconds, a short suffix and the configured Timer/Status patterns. New frontmatter must not include `track_record`. Existing 0.1.0 records and pending timer saves should remain readable/recoverable with their original content.
11. Set the same optional user on two devices. The local name must persist without appearing as a name value in shared settings. No device-name suggestion remains. Clear the user and confirm assigned users' timers stay open; only unassigned timers close. Existing device names and reset-all flags cannot change this behavior.
12. Configure nested record.user/start/end, then flat alternatives. Test missing, null, empty and whitespace-only ends. Status defaults to record.start and has no user/device field. Add comments, extra YAML fields and body text to an open timer, then Stop: retain them.
13. Create multiple same-user and other-user timers. Start/Stop must close exact owner matches only. A future start or conflicting edit must prevent a replacement. Cross-file writes can partially finish on an I/O failure.
14. Set a literal filename base without placeholders. The final name must still end in six hexadecimal characters as Base.abcdef.md; no new id/track_record property is written. A collision reports an error without expanding the suffix or overwriting.
15. Configure Timer subjects as projects and Status subjects as contexts. Add several note paths in each dialog. Check every linked note view, global time counted once, full duration per target and the explicit description that a multi-target status applies to all listed notes. Check aliases and duplicate-target handling.

## Mobile and synchronization — pending

- Repeat commands, dialogs and recovery on Android; use command palette/ribbon where no status bar is available.
- Interrupt in the background and terminate/reopen. Open records remain authoritative; no shutdown end time is inferred.
- Run timers on two devices with the same user and another with a different user. Sync records in either order and check filtering. No configured user leaves assigned users untouched. Only synchronized records can be acted on.
- Modify a pending destination before retry: content must not be overwritten.
- Check delayed metadata/link resolution and malformed/conflicting records. The preview cannot capture changes it never observed or guarantee cross-device exactly-once manual submissions.

## First release

Test deployment and user validation must precede the first release. Do not tag/publish 0.1.0 merely because the manifest contains that development version. The user approves the release and performs Community Plugins submission; temporary submission errors do not change this order.
