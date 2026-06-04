# Compiled Frontend Generator Package Manager

## Problem

Compiled OpenCorvus webpage/frontend generation currently materializes React/Vite seed projects that declare Bun as project truth. Downstream requirements/build agents correctly treat generated `package.json` and scripts as binding source evidence, so the compiled product tends to continue with Bun even when the user did not choose Bun.

## Evidence And Call Sites

| Surface | Current behavior | Action |
| --- | --- | --- |
| `packages/opencorvus/src/web-clone/source-project-generator.ts` `renderPackageJson` | Emits `bunx vite`, `bunx tsc`, and `packageManager: "bun@1.3.14"` for the frontend-design source project. | Replace with a shared generated frontend package profile. Scripts must call local bins (`vite`, `tsc`) so npm/pnpm/yarn/bun can run them without forcing Bun. |
| `packages/opencorvus/src/web-clone/skeleton-project-generator.ts` `renderPackageJson` | Emits `bunx vite` scripts for the older visual baseline project. | Use the same shared generated frontend package profile and local-bin scripts. |
| `packages/opencorvus/src/frontend-design/skeleton-project-tool.ts` | Calls `generateWebCloneSourceProject`; no package manager decision itself. | No code change needed; it inherits the generator fix in compiled builds. |
| `packages/opencorvus/src/tool/web-clone-generate-source-project.ts` | Calls `generateWebCloneSourceProject`; no package manager decision itself. | No code change needed; it inherits the generator fix in compiled builds. |
| `packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts` | Asserts Bun output. | Update to assert npm/default local-bin output and absence of `bunx`. |
| `packages/opencorvus/test/web-clone/skeleton-project-generator.test.ts` | Asserts Bun output. | Update to assert npm/default local-bin output and absence of `bunx`. |

## Decision

Generated frontend seed projects should not inherit OpenCorvus' own Bun implementation detail. The generated package profile is a single source in `frontend-package-profile.ts`, currently defaulting to `npm@10.9.0` with package-manager-neutral scripts:

- `vite --host 127.0.0.1`
- `tsc --noEmit`
- `vite build`
- `vite preview --host 127.0.0.1 --strictPort`

The scripts intentionally use package-local binaries. They run under `npm run`, `pnpm run`, `yarn`, or `bun run`, but the generated manifest no longer pins Bun.

## Verification

- `bun test packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts`
- `bun test packages/opencorvus/test/web-clone/skeleton-project-generator.test.ts`
- `rg -n "bunx|packageManager: \"bun@1\\.3\\.14\"|bun@1\\.3\\.14" packages/opencorvus/src/web-clone packages/opencorvus/test/tool packages/opencorvus/test/web-clone`
