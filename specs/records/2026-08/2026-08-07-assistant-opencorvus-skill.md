# Assistant-facing OpenCorvus Skill

## Recall

- User request: create a clearly explained OpenCorvus installation and usage skill for assistants such as Hermes and OpenClaw, with sufficient references.
- Acceptance criteria:
  - ship one portable Agent Skills-compatible directory with `SKILL.md` as its entry point;
  - explain how Hermes and OpenClaw install and invoke the skill without conflating skill installation with OpenCorvus installation;
  - guide an assistant through OpenCorvus source installation, provider setup, health verification, local CLI use, headless service use, Task creation and observation, operator follow-up, and diagnosis;
  - keep detailed commands and contracts in directly linked `references/` files;
  - validate the skill structure and every repository-local link.
- Hard constraints:
  - use the current repository and first-party Hermes/OpenClaw documentation as evidence;
  - preserve `README.md`'s source-build path as the only currently documented OpenCorvus installation authority;
  - do not invent package-manager distribution commands or hide failed checks behind alternative paths;
  - do not modify, stage, or commit the unrelated working-tree changes present before this task;
  - use the `dsw-33987` commit prefix and push only this task's commit to `git-cc`.
- Sources read:
  - root `README.md`, `README.zh-CN.md`, `package.json`, `.env.example`, and `install`;
  - `packages/opencorvus/package.json`;
  - CLI sources for `serve`, `run`, `doctor`, `auth`, `models`, and network options;
  - server routing, authentication, configuration precedence, and Task request schemas;
  - skill-creator `SKILL.md` and `references/openai_yaml.md`;
  - official Hermes Agent `website/docs/guides/work-with-skills.md`;
  - official OpenClaw `docs/tools/skills.md`.
- Whole-repository search evidence:
  - `rg --files -g 'SKILL.md'` established the existing skill conventions and showed no assistant-facing OpenCorvus operator skill;
  - targeted `rg` searches located installation commands, CLI registration, Task routes, Basic authentication, configuration precedence, product-pillar requirements, and current skill roots;
  - the branch is synchronized with `git-cc/v0.0.33beta`; the pre-existing working tree is dirty in Expert Squad and architecture files unrelated to this task.
- Independent agent feedback: not requested by the user, so no sub-agent was started.

## Design

Create `skills/opencorvus/` as a portable, repository-owned skill package:

1. Keep `SKILL.md` focused on intent classification, evidence-first setup, safe execution, verification, and reference routing.
2. Put assistant-host installation instructions in `references/skill-installation.md`.
3. Put OpenCorvus source installation and provider configuration in `references/opencorvus-installation.md`.
4. Put CLI and headless operating procedures in `references/operations.md`.
5. Put exact Task HTTP examples and header/authentication rules in `references/http-api.md`.
6. Put diagnosis procedures in `references/troubleshooting.md`.
7. Put first-party source links and repository evidence paths in `references/sources.md`.

The package contains no executable setup script. Installation mutates the user's machine and may involve credentials, so the assistant must inspect the environment, explain the intended command, receive the authority implied by the user's installation request, execute the single documented path, and verify the observed result.

## Verification

- Run the skill-creator `quick_validate.py` validator.
- Run a repository-local Markdown link check scoped to `skills/opencorvus`.
- Run targeted content checks for the required Hermes, OpenClaw, OpenCorvus, HTTP API, authentication, verification, and troubleshooting sections.
- Run the repository historical-document, document-health, and product-docs single-source tests required after changing the `specs/` index.
- Review the staged diff independently before committing and pushing.

## Implementation result

- Added `skills/opencorvus/SKILL.md` with outcome classification, reference routing, security boundaries, per-layer verification, and evidence-based completion semantics.
- Added assistant-host installation, OpenCorvus installation/configuration, CLI/service operations, HTTP API, troubleshooting, and first-party source references.
- Retained generated `agents/openai.yaml` metadata while keeping the package portable: Hermes Agent and OpenClaw consume the common `SKILL.md` plus relative references.
- The skill-creator validator passed, every repository-relative Markdown link resolved, every required topic was found, and `git diff --check` passed.
- The documented Task-create, follow-up-message, and cancellation bodies parsed successfully through the current Zod schemas, and the documented `doctor`, `run`, and `serve` options were confirmed through the live CLI help surface.
- Staged-diff review removed password expansion from curl process arguments; interactive examples now use curl's password prompt, and unattended operation routes credentials through a secret-aware host HTTP client.
- The three historical-document/document-health test paths named by repository instructions are absent from both this checkout and the current Git tree; Bun therefore reported no matching tests even with explicit `./` paths. This was not counted as a pass. The current executable documentation checker, `bun run docs:check`, passed with 315 operations in 24 groups.
