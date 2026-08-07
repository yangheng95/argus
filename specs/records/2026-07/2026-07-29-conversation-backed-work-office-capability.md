# Conversation-backed Work Office Capability

Date: 2026-07-29

## Recall

### User requirements

- Continue on the active `v0.0.23beta` baseline, not `v0.0.1beta`.
- Use the second proposed product shape: keep Work as a right-sidebar
  conversation and give it a multi-layer capability comparable in separation
  of concerns to Chat and Mission.
- Continue researching mature office-document Skills and configurations.
- Implement the missing capability rather than stopping at a proposal.
- Use independent Agents to find omissions before implementation and to review
  the final implementation.
- Commit and push the finished change to the git-cc `v0.0.23beta` line.

### Acceptance criteria

1. Work has its own Skill and Model Context Protocol (MCP) assignments rather
   than reading Chat configuration.
2. A progressively disclosed built-in Work presentation Skill explains the
   production and review workflow without copying proprietary Skill content.
3. Core-owned typed Work tools call one pinned, packaged OfficeCLI runtime.
   Chat, Coding, Mission, Task, and projected Expert-Squad workers cannot see
   those tools.
4. The first production slice creates PPTX files, validates them, renders every
   slide, and publishes the Office file plus review images through the existing
   message AttachmentStore and Interactive Artifact path.
5. Work can delegate independent review to a child Work conversation, while
   the child cannot delegate again or publish the final deliverable.
6. Non-image tool attachments, including PPTX, render as visible downloadable
   file chips in the Overlay.
7. Tests cover configuration isolation, tool visibility, Office process
   supervision, canonical attachment ownership, same-message artifact
   ownership, and Overlay rendering.
8. Real OfficeCLI output and the changed Overlay surface receive visual
   inspection. Structural checks or source assertions alone are insufficient.

### Hard constraints

- Conversation-backed Work is the only Work ingress in this change. Do not add
  a Work Expert Squad, Task Artifact, Engine Artifact, PromptProfile projection,
  hidden message, synthetic message, or second deliverable registry.
- Use the existing ordinary Skill, Session, AttachmentStore, Tool result, and
  Interactive Artifact infrastructure.
- OfficeCLI is invoked with an argument array, never through a shell. The typed
  tools do not expose `raw`, `raw-set`, `open`, `watch`, `mcp`, `skills`,
  installers, arbitrary output paths, or arbitrary commands.
- Runtime release is pinned to OfficeCLI `v1.0.143`, with exact per-platform
  assets and SHA-256 digests. Product runtime does not download or update it.
- `OFFICECLI_NO_AUTO_RESIDENT=1`; every call has an AbortSignal, inactivity
  timeout, descendant process cleanup, isolated temporary directory, and final
  cleanup.
- The first enabled authoring operation is PPTX creation. Existing-file edit,
  template round-trip, DOCX, XLSX, and PDF remain disabled until format-specific
  fidelity and security fixtures pass.
- `presentation@1` is a review projection whose slide images come from the
  produced PPTX. It is not described as a native PPTX viewer or the Office file
  itself.
- Preserve unrelated dirty work. Do not restart, refresh, or terminate the
  user's running OpenCorvus or Overlay.

### Sources read

Repository:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-28-work-conversation-experience.md`
- `specs/records/2026-07/2026-07-29-work-artifact-mode-research.md`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/agent/tool-pool-data.ts`
- `packages/opencorvus/src/chat/capability.ts`
- `packages/opencorvus/src/config/config.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/tool/delegate-agent.ts`
- `packages/opencorvus/src/tool/global-tools.ts`
- `packages/opencorvus/src/tool/tool-id-catalog.ts`
- `packages/opencorvus/src/tool/tool.ts`
- `packages/opencorvus/src/tool/publish-interactive-artifact.ts`
- `packages/opencorvus/src/storage/attachment-store.ts`
- `packages/opencorvus/src/interactive-artifact/schema.ts`
- `packages/opencorvus/src/interactive-artifact/persist.ts`
- `packages/opencorvus/script/build-artifact.ts`
- `packages/opencorvus/script/build-runtime-binaries.ts`
- `packages/overlay/src/components/InlineToolPart.tsx`
- `packages/overlay/src/components/FilePart.tsx`
- the built-in Skill payload generator and related tests

External primary sources:

- OfficeCLI repository and command documentation:
  <https://github.com/iOfficeAI/OfficeCLI>
- OfficeCLI `v1.0.143` release:
  <https://github.com/iOfficeAI/OfficeCLI/releases/tag/v1.0.143>
- OfficeCLI Apache-2.0 license:
  <https://github.com/iOfficeAI/OfficeCLI/blob/main/LICENSE>
- Agent Skills specification: <https://github.com/agentskills/agentskills>
- Microsoft Agent Framework Skills:
  <https://learn.microsoft.com/en-us/agent-framework/agents/skills>
- OpenAI plugin and Skill architecture:
  <https://developers.openai.com/plugins/concepts/plugins>
  and <https://developers.openai.com/plugins/build/skills>
- PptxGenJS repository and existing-deck limitation:
  <https://github.com/gitbrent/PptxGenJS> and
  <https://github.com/gitbrent/PptxGenJS/issues/99>
- LibreOffice license: <https://www.libreoffice.org/licenses/>
- Poppler README and GPL license:
  <https://gitlab.freedesktop.org/poppler/poppler/-/blob/master/README.md>

The installed Codex `presentations` Skill was read for workflow/acceptance
discipline only. Its private runtime, templates, and proprietary assets are not
copied or imported.

### Whole-repository search

Commands:

```text
rg -n "primary_assistant_capabilities|ChatCapability\.assignment|runtimeMcpTools\(|resolveSkillSurface\(" packages/opencorvus/src packages/opencorvus/test packages/overlay
rg -n "publish_interactive_artifact|AttachmentStore\.write|attachments\?|InteractiveArtifactPresentation" packages/opencorvus/src packages/opencorvus/test packages/overlay
rg -n "delegate_agent|LOCAL_DELEGATE_DISABLED_TOOLS|delegatedInstruction" packages/opencorvus/src packages/opencorvus/test
rg -n "copyRipgrepRuntime|build-runtime-binaries|artifactRipgrepExecutableName" packages/opencorvus/script packages/opencorvus/test
rg -n "InlineToolPart|toolImageAttachments|msg-tool-attachments|FilePart" packages/overlay/src packages/overlay/test
find packages/opencorvus/src/skill/builtin -maxdepth 3 -type f
```

Call-point disposition:

| Surface                                                                      | Disposition                                                                                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Config.PrimaryAssistantCapabilities`                                        | Add a separate `work` assignment with the built-in presentation Skill as the Work default.                        |
| `ChatCapability.assignment/assertConfig/resolveSkillSurface/runtimeMcpTools` | Generalize to exact `chat                                                                                         | work` ownership; keep existing Chat settings/update routes scoped to Chat. |
| `SessionLoop` conversation Skill and MCP resolution                          | Pass the exact conversation agent identity; rename Chat-only helper language where touched.                       |
| `PrimaryAssistantRegistry.buildState`                                        | Materialize Work independently; delete Chat cloning and the prompt claim that only the prompt differs.            |
| `AgentToolPool.roleAssignments`                                              | Add Work-only author, validate, and deliver tool IDs only to Work.                                                |
| `ToolRegistry` and global tool catalog                                       | Register the three Core tools so the declared pool can materialize them.                                          |
| `delegate_agent`                                                             | Permit Work parents; deny final Office delivery in child sessions.                                                |
| `AttachmentStore`                                                            | Reuse the canonical store and add exact Office MIME mappings where missing.                                       |
| `InteractiveArtifact`                                                        | Reuse `presentation@1` with images rendered from the produced PPTX; do not add another persistence model.         |
| `InlineToolPart`                                                             | Render all tool attachments through `FilePart`, preserving the existing browser-evidence de-duplication.          |
| binary build scripts                                                         | Copy a verified OfficeCLI release asset beside the packaged executable; never resolve the user's PATH at runtime. |

### Independent agent feedback

Two independent read-only Agents reviewed the selected Conversation-backed
shape before implementation.

The office-skill/runtime Agent concluded:

- public OpenAI, Microsoft, and Agent Skills designs all separate concise
  workflow Skills from typed server tools and progressively loaded resources;
- OfficeCLI is the only researched single-binary candidate that covers create,
  inspect, edit, validate, and render across PPTX/DOCX/XLSX;
- a real Office file must be a message attachment while the Interactive
  Artifact remains a derived review surface; and
- the first release must not claim template, cross-format, or PowerPoint
  fidelity that the current fixture set has not proven.

The repository-gap Agent found:

- Work currently clones Chat and reads Chat Skill/MCP assignments;
- Work's prompt tells it to use `delegate_agent`, but the tool rejects Work;
- tool-result Office attachments persist but are invisible because the Overlay
  filters them to images;
- Conversation Work cannot use Task/Expert-Squad artifact infrastructure; and
- a child Work reviewer must be able to inspect/validate while final delivery
  remains parent-owned.

The earlier adversarial Task-backed review remains relevant only for shared
runtime findings: pin the dependency closure, do not claim template editing
without fixtures, do not use the authoring runtime as the sole structural
authority, make render provenance explicit, test descendant termination, and
state the exact fidelity boundary.

## Decision

Implement five layers with one direction of dependency:

```text
Work conversation identity and capability assignment
  -> built-in work-presentations Skill and on-demand references
  -> Core-owned Work-only typed Office tools
  -> pinned packaged OfficeCLI runtime
  -> canonical message attachments and Interactive Artifact review surface
```

Chat and Work share the implementation of capability assignment, but not the
assignment data. Work and Mission remain different user-facing orchestration
levels: one Work conversation may delegate bounded independent review, while
Mission continues to own durable Tasks/Goals.

## First production slice

### Skill layer

Add `work-presentations`:

```text
packages/opencorvus/src/skill/builtin/work-presentations/
├── SKILL.md
├── PROVENANCE.md
└── references/
    ├── authoring.md
    ├── review.md
    └── security.md
```

`SKILL.md` stays concise and requires the author and validate tools. Parent Work
also owns deliver; a delegated Work reviewer deliberately lacks deliver but can
still load the same Skill and its review/security references. The Skill sends
the agent to one reference at a time. There is no host-side keyword router and
no new Skill family.

### Typed tool layer

Use three tools instead of an `action` switch:

- `work_office_author_presentation`
  - input: output filename, locale, aspect ratio, ordered slides, and bounded
    typed text/shape/picture/chart elements;
  - image sources are canonical project attachment URLs;
  - output: a canonical draft PPTX attachment reference plus bounded outline
    metadata.
- `work_office_validate_presentation`
  - input: canonical PPTX attachment URL;
  - runs independent ZIP/OOXML containment checks before OfficeCLI;
  - runs OfficeCLI schema validation and issue inspection;
  - renders every slide to fresh PNG attachments;
  - output: candidate digest, slide inventory, validator result, issue result,
    and exact render refs.
- `work_office_deliver_presentation`
  - input: the canonical PPTX ref, exact reviewed digest, and ordered slide
    annotations;
  - rechecks immutable attachment metadata and digest, then repeats package
    inspection, OfficeCLI validation, issue inspection, and fresh every-slide
    rendering inside the final call;
  - publishes `presentation@1` from those newly produced render refs on the
    same assistant message;
  - returns the final PPTX FilePart, PNG FileParts, and Interactive Artifact
    display part.

The separation is an ownership boundary, not a workflow state machine. The
prompt/Skill decides when to call each tool. Tools validate only data integrity
and immutable resource ownership.

### Office runtime layer

Runtime lock:

| Target        | Asset                          | SHA-256                                                            |
| ------------- | ------------------------------ | ------------------------------------------------------------------ |
| macOS arm64   | `officecli-mac-arm64`          | `2f158d46f9b6c5eb0dfe4eb02038114001e17acc47b67347417c56dcf9659096` |
| macOS x64     | `officecli-mac-x64`            | `693d243db616c74705fec9d92fdfc8a3db36acfcea378edb7264c2a30d339d9c` |
| Linux arm64   | `officecli-linux-arm64`        | `c50298e4698fcd1b15fe1a0f096405ad260b5c84d4440882582d0bba1e57bd49` |
| Linux x64     | `officecli-linux-x64`          | `6a29c598a789b57c92c03e560907d3f131a4bd0a068785b1d338a86fc31a58a7` |
| Alpine arm64  | `officecli-linux-alpine-arm64` | `3445c0992d4c746ed55606b30d366fc936ed87eed0cddbc18f0c0dfa40cf8cee` |
| Alpine x64    | `officecli-linux-alpine-x64`   | `6bdae606e4fd1b31da1b75f5e6e0280ee4cf203059c8844c15ec7a5cc200e6bb` |
| Windows arm64 | `officecli-win-arm64.exe`      | `51baf511fe136ee216fcc13cf0da9d18078da42212b22805c3a81f4163a4d7b9` |
| Windows x64   | `officecli-win-x64.exe`        | `d4d4c10fced307e209744cf98a56b003a6e613424fd651b08469274704afd2c6` |

The build downloads from the exact GitHub release URL, verifies the digest
before copy, and writes `bin/officecli[.exe]`. Runtime resolves only that
package-relative path. Source-mode tests inject an explicit fixture executable;
production code has no PATH or network fallback.

### Security and fidelity boundary

- Creation input contains no source Office archive, macros, OLE objects,
  embedded executables, external relationships, raw XML, remote resource URL,
  or caller path.
- Picture bytes must already be canonical project attachments and must satisfy
  MIME, byte-size, decoded-dimension, total-pixel, and single-frame limits.
- Output filename is a basename ending in `.pptx`.
- Independent ZIP inspection rejects traversal, encrypted entries, duplicate
  canonical names, excessive entry count, excessive uncompressed bytes,
  every OOXML part outside the create-only allow-list, unsafe media, macro
  content, OLE/ActiveX payloads, and external relationships.
- OfficeCLI validation and issue inspection are recorded, but do not replace
  the independent package inspection.
- Rendered PNGs prove OfficeCLI `v1.0.143` output on the tested platform. The
  release does not claim Microsoft PowerPoint pixel fidelity or existing
  template round-trip fidelity.

## Verification

Targeted tests:

```text
bun test packages/opencorvus/test/chat/capability-session-loop.test.ts
bun test packages/opencorvus/test/agent/primary-assistant-registry.test.ts
bun test packages/opencorvus/test/tool/delegate-agent.test.ts
bun test packages/opencorvus/test/skill/builtin-skills.test.ts
bun test packages/opencorvus/test/work-office
bun test packages/opencorvus/test/script/build-artifact.test.ts
bun test packages/overlay/test/inline-tool-output-summary.test.ts
```

Required broader checks:

```text
bun run typecheck
bun run version:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Real acceptance:

1. Package or stage the pinned macOS arm64 runtime.
2. Use the real typed author/validate/deliver implementation to create a deck
   with text, shape, picture, and native chart content.
3. Independently unzip and inspect the generated PPTX package.
4. Open every fresh render PNG and correct visible clipping, overlap, blank
   output, or wrong aspect ratio.
5. Start an isolated Overlay fixture with Node-backed Playwright.
6. Confirm the Work message shows the downloadable PPTX chip, rendered slide
   evidence, and Interactive Artifact without touching the user's running
   Overlay.
7. Capture and inspect the exact Work message region.
8. Run a final independent Agent review of code, tests, generated artifacts,
   packaging ownership, and acceptance evidence; repair every confirmed issue
   before commit/push.

## Independent implementation review and resolution

The final read-only reviewer confirmed the selected layering, Work-only tool
visibility, pinned runtime ownership, process supervision, packaging, and
initial OfficeCLI output. It blocked delivery on four concrete gaps:

1. final delivery trusted caller-provided render references instead of proving
   those PNGs came from validation of the supplied PPTX;
2. the product checked `issues.data.count` but not
   `validate.data.count`;
3. executable-content rejection was an incomplete extension deny-list; and
4. the first Overlay fixture showed only a PPTX chip, not the complete
   PPTX-plus-renders-plus-Artifact message.

The implementation was revised before commit:

- final delivery now repeats the complete validator and fresh-render pipeline
  and publishes only those new PNG references;
- both OfficeCLI result counts must be exactly zero;
- create-only PPTX inspection uses a deterministic OOXML part allow-list and
  decodes bounded image media;
- image attachments have dimension, pixel, and frame limits;
- the Work Skill remains available to a delegated reviewer without granting
  the parent-only delivery tool;
- a real Work SessionLoop test proves Work-owned MCP selection and Chat
  isolation; and
- the Node browser fixture uses the real two-slide OfficeCLI acceptance renders
  to show one message containing the PPTX, both PNGs, and the
  `presentation@1` review surface.

That browser review exposed an additional visible defect: the presentation
renderer placed semantic headings on top of a full-slide PNG and clipped the
actual render. Render-backed slides now use a full-page, contained image mode;
both Reveal navigation states were re-captured and inspected after the fix.

The repaired implementation passed:

- root typecheck for all ten packages;
- `98` targeted unit/integration tests with `0` failures and one intentionally
  skipped environment-gated real-runtime test;
- a separate real OfficeCLI `1.0.143` run covering author, review validation,
  final delivery validation, and four fresh render calls;
- Node headful browser acceptance for the PPTX chip, two PNG attachments, and
  both `presentation@1` navigation states;
- production Overlay Vite build;
- the native binary-only package build;
- packaged arm64 Mach-O and executable-mode checks; and
- the exact OfficeCLI and Apache-2.0 license SHA-256 checks.

The same independent reviewer then re-ran the repaired runtime/browser slice,
reported `39` passes with no failure, found no remaining blocker or
priority-one issue, and approved commit/push.
