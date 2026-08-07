# Remove Legacy Internal Remote Records — 2026-08-07

## Status

Complete. This record owns removal of the retired internal source-control
remote from the current public-source snapshot.

## Recall

### User request

- The user will copy the complete `v0.0.35beta` source into a new project and
  initialize new Git history.
- Remove the repository's records of the retired internal remote before that
  public-source rebuild.

### Acceptance criteria

- Remove the retired remote from repository-local Git configuration.
- Remove its name, compact spelling, hostname, repository URL, and remote-only
  transport instructions from every tracked current-tree file and filename.
- Point product repository metadata at the public GitHub repository.
- Preserve the substance of historical specifications while replacing obsolete
  delivery-provider wording with neutral legacy remote terminology.
- Do not rewrite existing commits; the user's new project initialization will
  discard old Git objects and reflogs.
- Verify zero current-tree or local-config matches, then commit the sanitized
  snapshot locally. Do not publish to the removed remote.

### Hard constraints

- Preserve the OpenCode acknowledgements and unrelated source changes.
- Do not blanket-remove `legacy-remote` from product/provider code where it does not
  identify the retired source-control remote.
- Use one mechanical text transformation for the historical spec corpus, then
  inspect the resulting diff and repair grammar/path references deliberately.
- No User Interface (UI) code or UI automation test is involved.

### Materials read

- Repository-local remotes and branch tracking configuration.
- `AGENTS.md` remote/push rules, `packages/web/config.mjs`, `specs/README.md`,
  and every tracked file matching the retired remote name, compact spelling,
  hostname, or internal repository URL.
- The current acknowledgement task record and current shared-worktree status.

### Whole-repository search

| Surface | Baseline | Planned action |
| --- | ---: | --- |
| Local Git remotes | One retired internal remote plus public `origin` | Remove only the retired remote and retain `origin` |
| Tracked matching files | 414 | Mechanically neutralize historical references, then inspect all remaining matches |
| Product configuration | Documentation site repository link used the internal URL | Replace with `https://github.com/yangheng95/opencorvus` |
| Agent rules | Contained a mandatory internal push target, ticket-prefix rule, and Windows transport workaround | Replace with provider-neutral local-commit/public-push guidance and delete obsolete transport instructions |
| Matching filenames | One historical spec filename used the compact internal name | Rename it and update every index/reference |

### Independent-agent feedback

- None. The user did not request delegated or parallel agents; this is a bounded
  mechanical sanitation task followed by a current-session review.

## Implementation plan

1. Update active product and agent configuration deliberately.
2. Rename the one matching historical spec path and update all references.
3. Apply exact mechanical replacements across tracked textual history:
   internal URLs to the public GitHub URL where they identify this repository,
   and provider-specific remote names to legacy remote wording elsewhere.
4. Remove the repository-local retired remote.
5. Search tracked files, filenames, working-tree files, and `.git/config` for
   zero residual identifiers; inspect the broad diff for accidental product
   changes.
6. Run documentation, route, type, formatting, and whitespace verification;
   update this record and commit locally.

## Verification evidence

- Repository-local Git configuration now contains only `origin`, with fetch and
  push URL `https://github.com/yangheng95/opencorvus`; `v0.0.35beta` tracks
  `origin/v0.0.35beta`.
- Exact searches for the retired remote name, compact spelling, underscore
  spelling, hostname, and full repository URL return zero tracked-file matches.
  Tracked filenames also return zero matches.
- `packages/web/config.mjs` now uses the public GitHub repository as both its
  GitHub and repository metadata authority.
- The one historical filename containing the retired compact spelling was
  renamed to `2026-07-28-landing-cta-contrast-and-remote-source.md`; both spec
  indexes point to the new path.
- `git diff --check`, `bun run version:check`, `bun run docs:check`,
  `bun run api:routes-check`, and the Bun 1.3.14 full workspace typecheck pass.
- Manual diff sampling covered active agent rules, product metadata, the
  current package-matrix record, the current branch-convergence record, and
  historical English and Chinese prose after the mechanical transformation.
