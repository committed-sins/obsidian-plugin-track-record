# Contributor instructions

- Sign every Git commit using the configured backend and key. Never bypass signing. If signing fails, preserve files uncommitted. Verify every new commit; report missing verifier/trust configuration without rewriting signed commits.
- Use English commit messages.
- Use Allman braces for functions, block-bodied arrow functions, methods, constructors, accessors and classes. Preserve control-flow brace style and keep formatter settings aligned. Do not reformat generated or third-party code.
- Preserve unrelated vault content, IDs, links, frontmatter, settings and workspace state.
- Keep work intervals distinct from time spent in a status. Do not infer active work from a status or an open note.
- Make record folders, property names and tags configurable. Treat the Continuum schema as an initial profile, not a universal requirement.
- Do not silently migrate notes, delete status properties, rename record folders or deploy to a vault. Prepare previewable migrations and obtain authorization for their application.
- Formulas are read-only. Do not introduce record-writing side effects into Bases evaluation.
- Design for interrupted sessions, repeated statuses and sync conflicts before enabling automatic writes. Observation time is not necessarily the original transition time.
- Keep private vault data, local paths, credentials and real records out of the repository and test fixtures.
- The user handles live Obsidian testing by default. Static checks do not establish desktop or mobile behavior.
