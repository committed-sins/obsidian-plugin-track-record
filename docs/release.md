# Release checklist

## Prepare and test

1. Keep the version in `manifest.json`, `package.json` and `package-lock.json` aligned with the minimum Obsidian version recorded in `versions.json`.
2. Run `npm ci` and `npm run release:prepare`. The local package in `dist/release/<version>/` includes the runtime files, license notices, release notes and SHA-256 checksums.
3. Deploy the candidate only to the Test vault and follow [the testing checklist](testing.md). Obtain Test-vault acceptance before publishing.
4. Push the signed, verified candidate commit. Use the Community directory's **Review branch** action to request a review of its commit SHA.

## Build the approved release

Update the default branch to the approved release commit, ensure CI passes, then create, verify and push a signed tag matching the manifest version, without a `v` prefix. Dispatch the workflow for the exact tag and wait for it to pass on Windows and Linux and to attest the release assets.

```powershell
gh workflow run ci.yml --ref $version
gh run watch $runId --exit-status
gh run download $runId --name track-record-release --dir dist/attested
```

Here `$version` is the signed tag, `$runId` is its successful workflow run and `$commit` is the full release commit SHA. Download into an empty directory. Verify each downloaded file before publishing.

```powershell
$repo = 'committed-sins/obsidian-plugin-track-record'
foreach ($asset in 'main.js', 'manifest.json', 'styles.css') {
    gh attestation verify "dist/attested/$asset" --repo $repo --source-ref "refs/tags/$version" --source-digest $commit --signer-workflow "$repo/.github/workflows/ci.yml"
    if ($LASTEXITCODE -ne 0) { throw "Attestation verification failed for $asset" }
}
```

## Publish and submit

Publish the verified CI files as individual assets and supply the release notes as GitHub release text. The source repository carries the licenses and notices. The bundled YAML license is also included in `main.js`.

```powershell
gh release create $version dist/attested/main.js dist/attested/manifest.json dist/attested/styles.css --verify-tag --title "Track Record $version" --notes-file "dist/release/$version/RELEASE_NOTES.md"
```

Download the published files, verify the same attestations and check the install in Test. The user submits or re-reviews the release in the Community directory.

- [Obsidian submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Obsidian Community directory review](https://docs.obsidian.md/community-directory/manage-entry)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
