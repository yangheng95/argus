# Squad and Skill Update Sources

Status: Implemented and verified.

## Recall

### Original request

用户要求给 Squad 和 Skill 增加更新功能，支持从 builtin 更新和从服务器更新；当前没有实际更新服务器部署。

### Acceptance criteria

1. 已安装的非 `general` Expert Squad 可以从当前应用内嵌 payload 原子更新，保持原安装作用域，不改变 `prompt_profile.active`。
2. builtin Skill 可以从当前应用内嵌描述符重新物化；不得把 builtin Skill 复制为第二份同名外置 Skill。
3. Expert Squad 与非 builtin、可写 Skill 可以通过同一个严格的更新服务器客户端获取 ZIP 更新；服务器地址来自唯一配置项，未配置时返回明确错误，不 fallback 到 builtin、本地导入或旧内容。
4. 服务器响应必须携带 exact kind、identity、version、SHA-256（Secure Hash Algorithm 256-bit，256 位安全哈希算法）和 ZIP；客户端在写入前验证响应 schema、identity、摘要及现有 Registry/Skill schema。
5. Squad 更新复用 `ExpertSquadPackageManager` 的 manifest-ID 锁、staging/backup/rename 和 Registry 校验；Skill 更新也使用 staging/backup/rename，删除旧目录中已不再存在的文件并在失败时恢复原目录。
6. Overlay 在现有 Expert Squad 与 Skill 设置面使用既有 Button/Settings primitives 暴露来源明确的更新动作、busy 状态和错误反馈；不增加第二个 catalog、第二个 active squad 字段或前端 shadow source。
7. 后端 manager/route、OpenAPI/SDK、Overlay service/UI、i18n、真实 Node Playwright 桌面截图和二次 diff review 全部通过。由于暂无服务器部署，服务器路径用进程内 HTTP fixture 验证，不声称生产服务器 E2E（End-to-End，端到端）通过。

### Hard constraints

- `expert-squad.jsonc` manifest `id` 与 Skill frontmatter `name` 仍是唯一身份；更新不得按目录名、label 或 ZIP 文件名猜测身份。
- `prompt_profile.active` 仍是唯一 active Expert Squad 来源；更新不激活、停用或改写 session/project/global 选择。
- 不增加 fallback、兼容 alias、server-to-builtin 自动降级、双份安装、状态机或流程 gate。
- server URL 只能来自严格配置，不接受 Overlay 传入任意 URL，避免把更新 route 变成任意服务端请求入口。
- 不重启、刷新、关闭或干预正在运行的 OpenCorvus/Overlay；视觉验收使用独立浏览器 fixture。
- 不创建 worktree，不使用 Git reset，保留所有无关工作区改动。

### Sources read before implementation

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-05-expert-squad-payload-seeding-and-skill-refresh.md`
- `specs/records/2026-07/2026-07-18-agent-skill-metadata-schema-repair.md`
- `specs/records/2026-07/2026-07-18-expert-squad-explicit-install-scope-actions.md`
- `packages/opencorvus/src/expert-squad/{manager,registry,locations,payload,catalog}.ts`
- `packages/opencorvus/src/skill/{manager,skill,builtin-source,builtin-payload}.ts`
- `packages/opencorvus/src/server/routes/{expert-squad,skill,global}.ts`
- `packages/overlay/src/components/settings/{ExpertSquadPanel,SkillMarketPanel}.tsx`
- `packages/overlay/src/services/{expert-squad,extensions}.ts`
- Matching manager, route, service, settings-surface and browser tests.

### Repository-wide search inventory

Repository-wide `rg` covered `ExpertSquadPackageManager`, payload install/release/market, folder/ZIP replacement, Registry discovery and identity locking, `SkillManager`, builtin materialization, managed git/URL refresh, Skill import/removal, all Expert Squad and Skill routes, Overlay lifecycle services, settings actions, translations, SDK operation generation and current records.

| Call point / owner | Disposition |
| --- | --- |
| `ExpertSquadPackageManager.installSourceDirectory` | Retain as the single atomic filesystem replacement owner; expose a builtin-update caller that selects exact installed scope and passes `replace: true`. |
| `installPayloadPackageSource` / `installPayloadPackage` | Keep install/release non-overwriting; add a distinct update method so install semantics do not silently change. |
| `importArchive` | Reuse for server Squad ZIP after response digest/identity validation; require `replace: true` and the caller-selected exact existing scope. |
| `ExpertSquadInstallLock` / Registry duplicate checks | Retain unchanged as the only manifest-ID serialization and global/project conflict authority. |
| `POST /expert-squad/install-payload` and `/release-payload` | Retain install/provision behavior; add one explicit `/expert-squad/update` operation rather than overloading install. |
| `Skill.materializeBuiltin` | Add explicit cache invalidation/rematerialization for exact builtin identity; do not create a filesystem-discovered duplicate. |
| `SkillManager.install` git/URL paths | Retain source installation. Update is identity-based and must not require the UI to resend or guess the source URL. |
| `SkillManager.installed` | Retain the single inventory and add update capability metadata derived from real builtin/writable/source state if required by the UI. |
| Skill dropped import | Retain install semantics. Server update validates exactly one matching Skill and atomically replaces the exact existing writable directory, including stale-file removal. |
| `POST /skill/install`, `/import-file`, `/remove`, `/policy` | Retain unchanged; add one explicit `/skill/update` operation. |
| Global Skill routes | Do not duplicate update globally: updates require an active project directory to resolve the exact discovered identity and target. |
| Config `Skills` | Do not revive the unmodeled `registries` cast as update authority. Add one strict shared update-server URL owner used by both package kinds. |
| Shared server client | New single client validates strict JSON envelope, exact kind/identity, base64 bytes, SHA-256 digest, timeout and HTTP status before either manager sees an archive. |
| Overlay Expert Squad service/panel | Add exact `{id, source, installationScope}` service call; installed payload rows and installed package details expose builtin/server actions according to real availability. |
| Overlay Skill service/panel | Add exact `{name, source}` service call; builtin rows expose builtin refresh, writable non-builtin rows expose server update, then refresh the canonical mount matrix. |
| OpenAPI/SDK | Regenerate from the two route schemas; do not hand-edit generated client types. |
| Tests | Add manager/route/service/UI/browser coverage for success, unconfigured server, kind/identity/digest mismatch, stale-file deletion, rollback, scope preservation and no activation mutation. |

### Independent-agent feedback

None. The user did not request delegation, and the current collaboration policy does not authorize sub-agents. The primary Codex agent owns a separate post-change exact-diff review.

## Implementation plan

1. Add the strict shared update-server config and archive-envelope client with focused contract tests.
2. Add distinct builtin/server update methods to the Expert Squad and Skill owners while preserving their identity and atomic replacement invariants.
3. Add project-scoped update routes, generate OpenAPI/SDK, and cover positive and negative route contracts.
4. Add Overlay service calls and source-specific update actions using existing settings primitives and translations.
5. Run focused backend/Overlay tests, typecheck, API/docs/i18n checks, document health and Node Playwright desktop visual acceptance; inspect screenshots, review the exact diff, update this record, commit with `dsw-33987`, and push `v0.0.9beta` to `legacy-remote`.

## Result

- Added one strict `package_updates.server_url` configuration source shared by Expert Squad and Skill updates. Only explicit HTTP/HTTPS URLs are accepted; an absent server configuration fails before any network request.
- Added one shared update client with fixed `v1/expert-squads/<identity>` and `v1/skills/<identity>` endpoints, a strict envelope, canonical base64 decoding, exact kind/identity checks, SHA-256 verification, HTTP status handling and a ten-second timeout. No server-to-builtin fallback exists.
- Expert Squad update now resolves the exact installed identity and installation scope, then either replaces it from the matching embedded payload or imports a server ZIP through the existing Registry and manifest-ID lock. Server envelope version and package manifest version must match. The update route does not write `prompt_profile.active`.
- Builtin Skill update now invalidates and rematerializes the canonical builtin payload. Server Skill update accepts only an existing non-builtin writable directory, validates exactly one matching Skill before mutation, and replaces the directory through staging/backup/rename so stale files disappear and the original target is restored on failure.
- Added `POST /expert-squad/update` and `POST /skill/update`, regenerated OpenAPI, the JavaScript software development kit (SDK) and English/Chinese API references, and used those generated route types in Overlay services.
- Added source-specific actions to the existing Expert Squad and Skill settings surfaces using the existing Button and Settings primitives. Expert Squad builtin availability requires the exact market ID and namespace; server remains an explicit separate action. Update completion refreshes the canonical catalog or Skill mount projection without changing active selection.
- The independent browser fixture initially failed before its health request because the strict transport protocol now requires an `executor`. The fixture was repaired with the canonical `opencorvus` executor; no production process was restarted or reused.

## Verification

- Shared client: 5 passed, including unconfigured server, exact URL, envelope kind/identity mismatch, non-canonical base64 and digest mismatch.
- Expert Squad manager update cases: 3 passed; route isolation suite: 1 passed with 48 assertions.
- Skill manager update cases: 3 passed; complete Skill route suite: 24 passed.
- Overlay focused service/settings/i18n suites: 27 passed with 308 assertions.
- Node browser runner: Expert Squad settings 4 passed; Skill settings 1 passed. Current desktop screenshots were inspected at `packages/overlay/.scratch/expert-squad-update-actions-current.png` and `.scratch/skill-update-actions-current.png`; actions, status feedback, spacing and clipping passed visual review.
- `bun run typecheck`, `bun run api:routes-check`, `bun run docs:check` and `git diff --check` passed after the final source narrowing fix.
- Server delivery is contract-tested against a real local HTTP fixture. No production update server is deployed, so production server end-to-end acceptance is intentionally not claimed.

## Codex review feedback

The exact-diff review tightened four areas before delivery: server envelope version must match the Expert Squad manifest version; server URLs are restricted to HTTP/HTTPS without throwing on malformed URL input; Overlay consumes generated Skill update types instead of maintaining a manual response type; and builtin Squad actions require namespace as well as manifest ID so same-ID packages from another namespace cannot be updated from the wrong payload source.
