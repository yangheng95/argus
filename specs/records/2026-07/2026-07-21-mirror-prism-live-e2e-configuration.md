# Mirror Prism Live End-to-End Configuration

Date: 2026-07-21
Status: In progress; source URL and page scope awaiting operator input
Owner: Codex

## Recall

### User request

Configure and run a real end-to-end (E2E) test for the newly ported Mirror Prism external Expert Squad. Ask the user directly whenever a required input cannot be discovered safely.

### Acceptance criteria

- Use the existing visible `overlay-web-benchmark.ts` runner so planning, Agent cards, terminal Task state, task-scoped preview, screenshot evidence, Integrity verdict and local verification remain observable.
- Install `mirror-prism` explicitly from the generated payload into the isolated benchmark project and select it only through `prompt_profile.active`; do not scan source folders or create a second active-profile field.
- Copy the existing real OpenCorvus authorization document from the canonical `Global.Path.data/auth.json` source into the isolated benchmark home without printing credentials.
- Preserve a visible browser and real Browser Model Context Protocol (MCP) execution. Do not use headless visual acceptance or restart the user's running OpenCorvus/Overlay.
- Require an explicit source URL, page-family scope and target mode from the user. Default to an isolated target project only after the user confirms the source input.
- Use an explicit benchmark model. Preserve the source role mapping where available; record that `MiniMax-M3` is unavailable in the local Hexin catalog before substituting another explicitly approved model.
- Accept the per-Agent model assignment through one explicit JSON map, validate it with the production runtime-override schema, require exact coverage of all projected Agents, resolve it through the installed package, and record it in the report.
- Persist the request, report, event stream, Agent traces, target project and screenshots as benchmark evidence. Do not call mocked/static contract tests an E2E pass.

### Hard constraints

- No fallback credentials, provider, model, source URL, target path, Expert Squad or browser.
- No temporary iframe, query override, synthetic message, hidden message, workflow state machine or automatic retry loop.
- Do not overwrite an existing Expert Squad installation or mutate the user's live project configuration.
- Do not stop, restart, refresh or reuse the currently running OpenCorvus/Overlay process; the benchmark owns an isolated server, database, home, browser and target project.

### Sources read

- `AGENTS.md`.
- `specs/records/2026-07/2026-07-21-mirror-prism-external-expert-squad-sdk-port.md`.
- `specs/current/architecture/04-extensions.md` and `specs/current/architecture/06-provider.md`.
- `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts`, `mission-benchmark.ts`, `mission-scenario.ts`, `env.ts` and their focused tests.
- The English and Chinese public benchmark operation guides and their document-health assertions.
- `packages/opencorvus/src/global/index.ts`, `auth/index.ts`, `agent/prompt-profile.ts`, `agent/runtime-override.ts`, `expert-squad/manager.ts`, `task-api/index.ts` and the Expert Squad server routes.
- Mirror Prism package README, selector, manifest and the active source export under `C:\Users\10132\Downloads\prism\output`.

### Whole-repository search evidence

| Search / call point | Evidence | Disposition |
| --- | --- | --- |
| `rg "overlay-web-benchmark\|mission-benchmark\|mission-e2e"` | The visible Overlay benchmark is the repository's complete frontend E2E runner; Mission benchmark owns a different Mission reconciliation contract. | Extend the visible Overlay runner; keep Mission benchmark aligned only for shared auth/profile provisioning. |
| `rg "promptProfile\|prompt_profile"` | `TaskAPI.createTask` already accepts `promptProfile`, validates it with `PromptProfileResolver`, and persists the session overlay. Overlay benchmark never supplies it. | Add one explicit `--prompt-profile` input and forward it through the existing Task API field. |
| `rg "installPayloadPackage\|releasePayloadPackages"` | `ExpertSquadPackageManager.installPayloadPackage` is the explicit single-package provisioning path. Neither benchmark installs a requested non-General profile. | Provision the exact requested payload package before Instance bootstrap; keep General on the built-in path. |
| `rg "auth.json\|Global.Path.data"` | Production Auth reads `Global.Path.data/auth.json`. Both benchmark scripts reconstruct `%APPDATA%/opencorvus/auth.json` on Windows, while this machine's real auth is under the XDG-derived canonical data directory. | Capture `Global.Path.data` before setting the isolated home and use one shared copy helper. |
| `rg "writeBenchmarkModelConfig\|OPENCORVUS_BENCHMARK_MODEL\|expert_squads"` | Overlay owns one isolated config file and currently writes only the project model and infrastructure options. Production per-Agent model selection is `expert_squads.<id>.agents.<agent-id>.runtime.model`. | Add the exact active profile and validated `--agent-model-map-file` projection to the same config document; do not add another runtime config source. |
| `rg "fs.rm.*\\.opencorvus\|project-level opencorvus state\|--project-dir"` | A fresh run against an explicit target recursively deleted the target's whole `.opencorvus` directory and root config before using the isolated config override. The custom `OPENCORVUS_CONFIG_DIR` is already the highest normal config-directory precedence, and a fresh database plus unique task identity does not require deleting prior project evidence. | Remove both target-config and target-runtime deletion. Preserve the explicit target project while the benchmark writes only its own new Task artifacts and requested implementation changes. |
| `opencorvus models hexin` | `hexin/gpt-5.6-sol`, `terra` and `luna` exist; `MiniMax-M3` does not. | Ask the user to approve the UI/UX substitution before performance comparison. |

## Implementation plan

- [x] Inspect benchmark, auth, config, Task API and package-install call points.
- [x] Add a shared canonical benchmark-auth copier with a real byte-preservation test.
- [x] Add explicit benchmark Expert Squad provisioning and profile selection to the visible Overlay runner; align Mission benchmark's existing profile flag.
- [x] Add the visible benchmark's explicit Agent model-map input, production-schema parsing, exact installed-projection coverage check, provider/model preflight and report evidence.
- [x] Add focused regression tests for flag validation, generated config, explicit install, active Resolver projection, exact model-map coverage and Task API forwarding.
- [x] Remove the fresh `--project-dir` path's recursive `.opencorvus` and project-config deletion; assert the isolated config override remains the benchmark config owner.
- [ ] Obtain source URL/page scope and model substitution decision from the user.
- [ ] Create the isolated target, request artifact and verification command, then execute the live benchmark.
- [ ] Inspect screenshots and traces, fix every in-scope defect, rerun, record evidence, commit and push to legacy remote.

## Known environment facts

- The real auth catalog contains a `hexin` entry; no secret value is printed or copied into tracked files.
- The live Hexin provider catalog resolves `gpt-5.6-sol`, `gpt-5.6-terra` and `gpt-5.6-luna`; it does not contain `MiniMax-M3`.
- The visible browser fixture already passed locally in the static port acceptance.
- A repository-wide Expert Squad projection rerun first observed a concurrent missing-file copy error under `mirror-watch`; after that file appeared, the suite still exceeded Bun's five-second hook timeout on Windows. The exact Mirror Prism install-and-resolve preflight passes with an explicit 30-second test timeout, so this remains a separate shared-workspace fixture performance issue rather than Mirror Prism configuration evidence.
- A real source URL and requested page boundary cannot be inferred without changing benchmark meaning, so execution pauses at that input boundary while generic benchmark configuration continues.
