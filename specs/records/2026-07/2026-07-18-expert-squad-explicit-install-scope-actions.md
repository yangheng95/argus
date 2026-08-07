# Expert-squad explicit install-scope actions

Status: Implemented and verified.

## Recall

### Original request

用户要求安装 Squads 时显式提供“全局安装”和“项目级安装”，删除只保留一个按钮。

### Acceptance criteria

1. Expert Squads Market 中每个未安装包同时显示两个明确动作：全局安装与项目安装；不再用一个语义不明且硬编码为 global 的“安装”按钮。
2. 两个动作分别向现有 `POST /expert-squad/install-payload` 契约发送 `installationScope: "global"` 与 `installationScope: "project"`，继续由 `ExpertSquadPackageManager` 和 Registry 完成严格安装。
3. 已安装包继续只显示 installed 状态；Details 中非内置包继续只有一个删除按钮，按钮从 catalog 的 `source.installation_scope` 精确确定删除作用域。
4. 不增加第二个安装端点、默认作用域、fallback、兼容 alias、前端 shadow state 或第二个删除入口。
5. Overlay 单元契约、service 请求测试、Node 启动的真实浏览器交互与当前截图通过；视觉复核确认双安装动作和单删除动作清晰且不拥挤。
6. 不重启、刷新或干预用户正在运行的 OpenCorvus/Overlay；只使用独立浏览器 fixture。

### Hard constraints

- `expert-squad.jsonc` 的 manifest `id` 仍是唯一身份，`prompt_profile.active` 仍是唯一 active 来源。
- 全局与项目安装继续使用现有 `installationScope` discriminated input；不更改 Manager、Registry 或 route ownership。
- 删除继续使用已安装 package 的 `source.installation_scope`，并复用现有引用收敛确认与单一卸载请求。
- 保留工作区内所有无关未提交修改；尤其不把 i18n 文件中并行的 model-selector 改动纳入本任务。
- 桌面端验收；Playwright 必须由 Node runner 启动。

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-16-expert-squad-settings-capability-redesign.md`
- `specs/records/2026-07/2026-07-17-multica-global-expert-squad-storage.md`
- `specs/records/2026-07/2026-07-17-expert-squad-uninstall-reference-convergence.md`
- `packages/opencorvus/src/expert-squad/{locations,manager,registry}.ts`
- `packages/opencorvus/src/server/routes/expert-squad.ts`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/services/expert-squad.ts`
- Matching Manager, route, Overlay service, source-contract, i18n and rendered-browser tests.

### Full-repository search evidence

Repository-wide `rg` covered `installExpertSquadMarketPackage`, `installPayloadPackage`, `/install-payload`, `expert-squad-market-install`, `installation_scope`, `installationScope`, uninstall call points, install labels and both scope labels.

| Call point | Disposition |
| --- | --- |
| Overlay `installMarketItem` | Accept an explicit `project | global` scope and pass it unchanged to the existing service; use scope-qualified busy identity. |
| Market row action | Replace the single generic Install button with two explicit buttons using existing scope labels and Button primitives. |
| Overlay lifecycle service | Retain its existing required `installationScope` argument and request body; extend tests to prove both values. |
| `POST /expert-squad/install-payload` | Retain unchanged; its strict schema already requires an explicit scope. |
| `ExpertSquadPackageManager.installPayloadPackage` | Retain unchanged; it already resolves exact global/project target roots under the manifest-ID lock. |
| Local folder/ZIP import | Retain the existing explicit scope selector and strict request body; it is a secondary source workflow, not the ambiguous Market action. |
| `uninstallCurrent` and Details action | Retain exactly one button and one request; catalog `source.installation_scope` selects the exact Manager target. |
| Browser and source tests | Assert two Market buttons with distinct scope metadata/request bodies and one uninstall button; capture and inspect current screenshots. |

### Independent-agent feedback

No sub-agent was started because the user did not request delegation. The primary agent will perform a separate post-change diff review.

## Implementation plan

1. Make the Market install handler scope-explicit and render global/project install buttons with distinct stable selectors.
2. Update focused source, service and rendered-browser regressions to prove both request bodies and the single uninstall action.
3. Run Overlay type/i18n/focused tests, Node browser visual acceptance, docs link checks and `git diff --check`; inspect screenshots and final diff before delivery.

## Result

- Every uninstalled Market row now renders two equal explicit actions: `Install globally` and `Install for project` (`全局安装` / `项目级安装`).
- The handler accepts the selected `global | project` value and passes it unchanged to the existing `installExpertSquadMarketPackage` service. Busy identity includes the scope, so the visible progress belongs to the exact action clicked.
- Installed rows still collapse to one Installed pill. Details still renders exactly one Uninstall button and derives its request scope from `squad.source.installation_scope`.
- The existing strict route, Manager, Registry, manifest identity, and `prompt_profile.active` ownership were unchanged.
- The shared browser settings fixture was repaired by deleting the retired persisted `executor` field. Before that repair, strict settings parsing stopped initialization before `/global/health`, leaving every browser test offline; the fixed fixture now matches the current transport protocol and restores the real test chain.

## Verification

- `bun test packages/overlay/test/expert-squad-settings-surface.test.ts packages/overlay/test/expert-squad-lifecycle-service.test.ts --timeout 180000` — 14 passed, 0 failed, 244 assertions. The service test proves exact global and project request bodies; the source contract proves both action selectors and exactly one uninstall selector.
- `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` — 4 passed, 0 failed. The rendered test clicks a global install for `mirror-watch`, a project install for `opentest`, proves both request bodies, and proves one visible uninstall button before the existing confirm/delete/refetch path.
- `bun run --cwd packages/overlay typecheck` — passed.
- `bun run --cwd packages/overlay check:i18n` — passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 180000` — 21 passed, 0 failed, 70 assertions.
- `git diff --check` — passed.
- Fresh screenshots personally inspected at original resolution:
  - `packages/overlay/.scratch/expert-squad-market-current.png`: both explicit install actions are readable without clipping or row-density regression.
  - `packages/overlay/.scratch/expert-squad-market-global-and-project-installed-current.png`: both chosen packages become normal Installed rows after the distinct requests.
  - `packages/overlay/.scratch/expert-squad-uninstall-confirm-current.png`: deletion remains one clear destructive confirmation action.

## Post-change review

The final diff keeps one installation endpoint and one uninstall endpoint. Scope is required at the UI action, service input, route schema and Manager target resolution; no default/fallback scope or parallel lifecycle owner was introduced. The browser-fixture repair removes a retired field rather than making strict parsing tolerant, so it restores the current single contract instead of adding compatibility behavior.
