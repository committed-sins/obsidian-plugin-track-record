# Testing and release gate

## Automated checks

Run `npm ci` followed by `npm run check` with Node.js 22+. The check includes strict TypeScript, an AST-based Allman check, browser/CJS bundling and 26 tests. `npm run format` uses TypeScript formatting plus Allman placement for functions/classes; generated bundles and third-party code are excluded.

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
6. Start a timer and disable/re-enable the plugin or close/reopen Obsidian. It should report an interrupted draft. **Recover interrupted timer** requires an actual end time. Cancel recovery, reopen it, then complete it.
7. Rename/move a subject while retaining its string `id`, then stop the timer. Confirm attribution. Without an ID, test a live rename with native link updates; an offline rename can require restoring the old path. Duplicate note IDs should block new recording once indexed.
8. Change folder/property names in settings and save another record. Earlier records should remain readable using their embedded mappings after metadata indexing; refresh history. No prior record is migrated.

## Mobile and synchronization — pending

- Repeat commands, dialogs and recovery on Android; use command palette/ribbon where no status bar is available.
- Interrupt in the background and terminate/reopen. Choose actual end times explicitly.
- Run independent timers on two devices, sync closed records in either order and check that both remain present and overlaps are flagged.
- Modify a pending destination before retry: content must not be overwritten.
- Check delayed metadata/link resolution and malformed/conflicting records. The preview cannot capture changes it never observed or guarantee cross-device exactly-once manual submissions.

## First release

Test deployment and user validation must precede the first release. Do not tag/publish 0.1.0 merely because the manifest contains that development version. The user approves the release and performs Community Plugins submission; temporary submission errors do not change this order.
