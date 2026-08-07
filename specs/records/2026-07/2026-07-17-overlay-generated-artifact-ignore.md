# Overlay Generated Artifact Ignore

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Add compiled artifacts to `.gitignore`. |
| Acceptance criteria | The canonical native Overlay output directory is ignored; currently tracked installers and executables leave the Git index without deleting local files; CI continues to build and upload the same path; a regression rejects future tracked output. |
| Hard constraints | Preserve packaging scripts and workflow artifact upload; do not delete local build outputs; do not add duplicate extension-by-extension ignore rules; commit subjects use `dsw-33987`; push the current main delivery branch to `legacy-remote`. |
| Sources read | Root `.gitignore`; `script/package-gui-installer-matrix.ts`; `.github/workflows/build.yml`; `.github/workflows/build-overlays.yml`; `packages/opencorvus/test/script/repository-intermediate-residue.test.ts`; the installer-artifact disposition in `2026-07-16-platform-legacy-debt-cleanup.md`. |
| Whole-repository search | Generic `dist/`, `dist-vite/`, `target/`, and `build/` outputs are already ignored. `packages/overlay/dist-artifacts/<platform>` is the single missing generated root, produced by `package-gui-installer-matrix.ts` and uploaded by both build workflows. Eight files beneath it are currently tracked. Existing architecture evidence explicitly defers removal until release retention is decided; the user's request resolves that decision in favor of generated CI/local output rather than source retention. |
| Independent agent feedback | No sub-agent was started because the user did not request delegation and current collaboration policy forbids unrequested sub-agents. |

## Implementation

1. Add the exact generated root `packages/overlay/dist-artifacts/` to the repository `.gitignore`.
2. Remove the eight existing outputs from the Git index with `git rm --cached`, preserving their local filesystem contents.
3. Extend repository residue coverage to assert both the ignore entry and zero tracked files under the generated root.
4. Run the focused residue and document-health tests, prove `git check-ignore` resolves representative platform output, verify the local files still exist, commit, merge any new `legacy-remote` changes, and push.
