# Release checklist - 0.1.6

Prepared 2026-11-21. This is a candidate for the first public release. No tag, release or Community submission is created by the preparation command.

## Prepared

- Public repository, MIT license, README, manifest and versions map.
- Runtime uses public Obsidian/Web APIs, without Node/Electron imports. Manifest minimum is 1.11.4. This is API compatibility, not a claim that every older desktop/mobile version was tested.
- TypeScript, Allman style, official Obsidian ESLint recommended checks, browser build and 66 automated tests.
- One advisory lint warning remains: imperative staged settings do not participate in Obsidian 1.13+ declarative settings search. The setting controls remain available normally. The control-character-regex rule is scoped off in the input validator because detecting those characters is its purpose.
- Pinned ESLint 9 matches the official plugin's dependency peers. The official plugin currently brings a vulnerable older minimatch through eslint-plugin-n; a narrow development-only override pins patched 11.0.9. Run npm audit after dependency updates. No lint tooling enters the runtime bundle.
- Bundled yaml ISC copyright/license in main.js, with standalone LICENSE and THIRD_PARTY_NOTICES.md.
- Read-only GitHub Actions checks on Windows and Linux with pinned action commits. It performs no release or vault deployment.
- Local preparation: `npm ci`, then `npm run release:prepare`.

## Acceptance still required

- Load the updated plugin in Test. The first load initializes observations; it cannot know a prior shutdown.
- Start a timer, close Test normally and reopen. Verify continue, end-at-close and custom end choices; dismiss/reopen a reminder.
- Confirm ordinary source notes, settings and existing records remain unchanged except the chosen timer end.
- Check real mobile interruption/synchronization before claiming mobile behavior is verified. Bases Excerpts section extraction is a separate pending integration check.
- Obtain explicit user release approval after Test-vault acceptance.

## Prepared files

`dist/release/0.1.6/` contains main.js, manifest.json, styles.css, LICENSE, THIRD_PARTY_NOTICES.md, SHA256SUMS and RELEASE_NOTES.md. The three runtime files match the Test deployment. SHA256SUMS covers the runtime and license files. Re-run preparation after any code change.

## Publish only after approval

1. After acceptance, promote candidate wording in README and release notes to the final release wording. Ensure the approved commit is signed, verified, pushed and has a successful CI check. Regenerate/verify the prepared files from that commit.
2. Create a signed tag `0.1.6` for that exact commit, verify its signature using the configured trust file, and push only that tag. Do not prefix the tag with v.
3. Use gh to create the release with the prepared runtime files and notices. Example, to be executed only after approval:

```powershell
gh release create 0.1.6 dist/release/0.1.6/main.js dist/release/0.1.6/manifest.json dist/release/0.1.6/styles.css dist/release/0.1.6/LICENSE dist/release/0.1.6/THIRD_PARTY_NOTICES.md dist/release/0.1.6/SHA256SUMS --verify-tag --title "Track Record 0.1.6" --notes-file dist/release/0.1.6/RELEASE_NOTES.md
```

4. Verify uploaded assets against SHA256SUMS and test a download/install in Test.
5. The user submits the public repository in the Obsidian Community directory. A matching GitHub release with binary assets must exist first; the directory reads the default-branch manifest. Do not use the former obsidian-releases pull-request workflow.

Sources checked on 2026-11-21: [submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [developer policies](https://docs.obsidian.md/community-directory/developer-policies).
