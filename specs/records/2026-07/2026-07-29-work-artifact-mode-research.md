# Work Artifact Mode Research

Date: 2026-07-29

## Recall

### User requirements

- Research the skills and configuration used for PowerPoint and adjacent
  knowledge-work scenarios.
- Determine how OpenCorvus should complete and strengthen its `Work` mode.
- Prefer a root-cause architecture proposal over isolated prompt additions.

### Acceptance criteria

1. Separate the Composer `Work` route from the domain capability that produces
   office artifacts.
2. Inventory the current OpenCorvus Skill, expert-squad, tool, Model Context
   Protocol (MCP), attachment, and Artifact surfaces that can carry the feature.
3. Compare mature PowerPoint, Word, spreadsheet, and Portable Document Format
   (PDF) skill packages by their runtime, resources, verification, and delivery
   contracts rather than by prompt text alone.
4. Recommend one OpenCorvus architecture with a single capability source, no
   keyword router, no fallback runtime, and no second active expert-squad field.
5. Provide a concrete package/configuration shape, phased implementation order,
   and user-visible acceptance criteria.

### Hard constraints

- `Work` remains an explicit Composer route into the existing Task workflow; it
  must not become a host-side state machine.
- `prompt_profile.active` remains the only active expert-squad selection source.
- Domain capability projects through `PromptProfileResolver`; the Overlay,
  Skill mount surface, and Task runtime must not discover independent copies.
- No prose keyword gate, hidden message, synthetic message, compatibility
  fallback, or duplicate artifact registry.
- Use mature document-generation and rendering toolchains. Do not handcraft an
  Office file format or copy proprietary OpenAI runtime code/templates.
- Do not depend on the user's Codex cache, ChatGPT desktop installation, or
  another product's private runtime.
- Do not restart or otherwise interact with the user's running OpenCorvus or
  Overlay process.
- Preserve all unrelated dirty and untracked work.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/05-config.md`
- `specs/records/2026-07/2026-07-29-code-work-composer-routing.md`
- `packages/web/src/content/docs/skills.mdx`
- `packages/opencorvus/src/skill/skill.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- current `.opencorvus/expert-squads/**/expert-squad.jsonc` packages
- installed Codex `presentations`, `documents`, `spreadsheets`, and `pdf` Skill
  packages, bundle version `26.727.11326`
- installed workspace dependency manifest and the local
  `@oai/artifact-tool@2.8.33` package metadata/license
- OpenAI Codex glossary, configuration reference, and plugin packaging
  documentation
- Anthropic Agent Skills overview and PowerPoint quickstart
- Microsoft Agent Framework Agent Skills documentation

External primary sources:

- <https://learn.chatgpt.com/docs/glossary>
- <https://learn.chatgpt.com/docs/config-file/config-reference>
- <https://developers.openai.com/plugins/build/plugins#plugin-structure>
- <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>
- <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/quickstart>
- <https://learn.microsoft.com/en-us/agent-framework/agents/skills>

### Whole-repository search

Commands:

```text
rg -n --hidden -S "work mode|work_mode|work-mode|presentation|pptx|spreadsheet|xlsx|document|docx|artifact-tool|artifact_tool|mission skill|mission_skill|expert squad|expert-squad|PromptProfileResolver" packages specs .opencorvus
rg -n "PromptProfileResolver|skill_mount|skills|mcp|package_tools|tools" packages/opencorvus/src/expert-squad packages/opencorvus/src/skill packages/opencorvus/src/config -g "*.ts"
rg -n '"@oai/artifact-tool"|artifact-tool|pptxgenjs|python-pptx|python-docx|openpyxl|libreoffice|soffice|pdftoppm|presentation|spreadsheet|document' package.json bun.lock packages/*/package.json script .github
rg -n "ArtifactStore|ArtifactCatalog|artifact_search|RunArtifact|EngineArtifact|task.*artifact" packages/opencorvus/src packages/overlay/src -g "*.ts" -g "*.tsx"
find .opencorvus/expert-squads -type d \( -name skills -o -name tools -o -name mcp \)
```

### Independent agent feedback

The implementation continuation used three independent read-only reviews:

- an external Office Skill/runtime/license survey;
- a whole-repository Work/Expert-Squad/Artifact call-point audit; and
- an adversarial plan review covering distribution, fidelity, security,
  lineage, rendering, fonts, process cleanup, and real acceptance.

Their blocker findings and dispositions are recorded below. This is an explicit
revision of the earlier recommendation, not a silent rewrite.

## 2026-07-29 implementation correction after live `v0.0.23beta` audit

The original proposal incorrectly treated `Work` as a Task Orchestrator
surface. In `v0.0.23beta`, Work is a right-sidebar primary-assistant
conversation created through `/coding/work`; it shares the Chat tool pool plus
`panel`. It has neither Task ownership nor `select_expert_squad`. Consequently:

- a Work conversation cannot project or select `work-artifacts`;
- Task Artifact discovery/publication tools cannot be used from that session;
- message-owned Interactive Artifacts are the current Work review surface and
  are not Task Artifact Catalog entries; and
- adding an Expert Squad package without changing ingress would create an
  installed capability that the Work route cannot reach.

The first production slice therefore starts by choosing and testing one of two
mutually exclusive product shapes:

1. **Task-backed Work** — replace Work conversation creation, `/coding/work`,
   `panel.wake_work`, native Work identity, and related tests with a fixed
   `prompt_profile.active=work-artifacts` Task ingress. This is required if the
   final binary and previews must live in the canonical Task Artifact Catalog.
2. **Conversation-backed Work** — preserve the existing Work conversation and
   implement an ordinary Work Skill plus a Work-only typed tool whose outputs
   are real message attachments/Interactive Artifacts. This shape must not
   claim Task Artifact Catalog semantics or pretend an Expert Squad is active.

The two shapes must not coexist. Because the existing user-visible Work
semantics are conversation-backed, changing them to Task-backed Work is a
separate product/route refactor, not an incidental PPTX runtime patch. No
Expert Squad or Catalog code may be added before that route decision is
implemented and its old behavior is deleted.

### Runtime decision correction

PptxGenJS remains a strong clean-room **create-only** library, but it cannot
ingest an existing PPTX. It therefore cannot satisfy the original template
round-trip/editing acceptance.

The preferred runtime candidate is now
[`iOfficeAI/OfficeCLI`](https://github.com/iOfficeAI/OfficeCLI), subject to a
real fixture benchmark:

- Apache-2.0;
- one self-contained binary for DOCX, XLSX, and PPTX;
- structured JSON/DOM create, inspect, edit, validate, issue detection, and
  PNG/HTML rendering;
- per-platform release assets with published SHA-256 digests; and
- no requirement for a local Office or .NET installation at runtime.

OpenCorvus may adopt only a pinned release asset, checksum, license/NOTICE,
software bill of materials, and narrow typed wrapper. It must not execute the
project's online installer, auto-configure user Agents, start global resident
mode, expose arbitrary raw XML/shell operations, or download the binary at
runtime.

The first benchmark target is OfficeCLI `v1.0.143`, published 2026-07-28. The
official release supplies macOS arm64/x64, Windows arm64/x64, Linux arm64/x64,
and Alpine arm64/x64 binaries with GitHub release digests. Passing the
benchmark is necessary but insufficient: the release packaging matrix must
still own the verified binaries before product code can call the runtime.

### Phase 0 benchmark evidence

The macOS arm64 release candidate was downloaded as bytes only; no installer,
Skill installer, MCP registration, global configuration, or resident/watch
process was invoked.

```text
OfficeCLI version: 1.0.143
official macOS arm64 SHA-256:
  2f158d46f9b6c5eb0dfe4eb02038114001e17acc47b67347417c56dcf9659096
verified local binary SHA-256: identical
OFFICECLI_NO_AUTO_RESIDENT: 1
```

The first real smoke benchmark:

1. created a three-slide PPTX;
2. added positioned text/shape content;
3. added an editable column chart with categories and series data;
4. reopened the document through the structured DOM;
5. validated it against the runtime's Open XML schema with zero reported
   errors;
6. ran issue inspection with zero reported issues; and
7. rendered all three slides independently to 1280×720 PNG files and visually
   inspected the title, body, rounded rectangle, chart, axes, labels, colors,
   and slide boundaries.

Evidence digests:

```text
PPTX    e4dd9a29b936baf737f715f36ca40c0cf5bb7181af7f13ae26d2c5141986c498
slide 1 58c3629740247c1a9d0926cff4a70bce33aeaebc46ba6ed394fb637b201681bc
slide 2 9a543bcba557cb52ee2a07e67e53faedcca64314e435f8db6a56d73885e56c7a
slide 3 34620edf9884493fa055149be55b3ebe4057297ac83f0def59dbe26bea614a8a
```

This proves a promising create/inspect/validate/render path on one development
platform. It does **not** yet prove template round-trip fidelity, master/layout
preservation, notes/media/animation preservation, malicious-input safety,
independent structural validation, Microsoft PowerPoint no-repair behavior,
packaged runtime availability, or cancellation/process-tree cleanup. Those
remain mandatory before the production tool is enabled.

### Corrected implementation sequence

1. Benchmark the pinned OfficeCLI binary without running its installer:
   create a deck, edit a real template, validate structure, enumerate issues,
   render every slide, and independently reopen the result.
2. Record unsupported operations and decide whether the first release is
   create-only or create-and-edit. Do not add PptxGenJS as a second path.
3. Decide and implement exactly one Work ingress shape above, deleting the old
   competing behavior in the same change.
4. Add one release-owned Office runtime lock containing version, operating
   system/architecture asset, SHA-256, license/NOTICE, package-relative
   location, and update policy.
5. Add one typed Office runtime tool surface. It owns input containment,
   process supervision, cancellation, independent temporary/profile roots,
   output attachment or Task Artifact publication, and cleanup.
6. Add progressively disclosed format Skills and only the resources required
   by the selected ingress.
7. Add independent structural validation and cross-render acceptance. A
   renderer validating its own output is not the sole acceptance authority.

### Corrected artifact contract for Task-backed Work

If Task-backed Work is selected, use the existing Artifact ABI exactly:

- `artifact_type: "work-artifacts/work-deliverable"`;
- complete structured `TaskArtifactRef` values for the PPTX and every preview,
  never invented `artifact://` strings;
- provenance only in the canonical Engine Artifact envelope, not duplicated
  in payload;
- immutable `pptx_candidate` → independent `pptx_visual_review` →
  `work-deliverable` lineage; and
- one binding non-Goal workflow whose author, reviewer, and publisher nodes
  are all mandatory.

The reviewer artifact must identify the candidate digest and each rendered
slide resource. A count and a model-authored `"passed"` value do not prove
visual inspection.

### Corrected source and distribution paths

If Task-backed Work is selected, the repository authoring source is
`expert-squads/builtin/work-artifacts/`; generated payload provisioning installs
it at `.opencorvus/expert-squads/builtin/work-artifacts/`. The original
namespace-free path in this record is invalid. The manifest must use the exact
current schema, including namespace, version, readme, selector, complete
resource arrays, `goal_concurrency`, and `virtual_workflows`.

### Additional release blockers

- First-release inputs reject macro-enabled Office files, external
  relationships, executable/OLE payloads, unsafe ZIP paths, decompression
  bombs, and over-limit media unless a narrower reviewed contract explicitly
  supports them.
- Font identities, licenses, versions, and resolved substitutions are
  verification evidence. Silent font fallback is not acceptance.
- A child-process exit alone does not prove cleanup. Cancellation tests must
  prove descendant termination and removal of locks, temporary files, and
  runtime profiles.
- OfficeCLI rendering needs an independent Open XML parser and release CI
  cross-render. PowerPoint fidelity may be claimed only after a legal Windows
  PowerPoint open/no-repair/render check; otherwise the promise remains
  structural OOXML validity plus the named renderer's visual output.
- Google Workspace remote MCP is Developer Preview and cloud APIs/connectors
  remain optional distribution/collaboration surfaces. They do not replace
  the local runtime.

The original investigation remains below as historical reasoning. Where it
conflicts with this correction, this correction is authoritative.

## Executive decision

Do not implement Work capability as a larger global prompt or a new runtime
mode. Implement one package-backed `work-artifacts` expert squad that projects:

1. artifact-specific Skills;
2. a small set of typed artifact-runtime tools;
3. artifact-specific author/reviewer Agent overlays;
4. a renderer-backed verification contract; and
5. final-file publication into the existing Task Artifact Catalog.

The existing `Code | Work` control answers **where the request runs**. The
active expert squad and mounted Skills answer **what capability it has**.
Keeping those questions separate avoids turning the Composer into a document
type router.

`work-artifacts` should be selected through the existing typed Squad reference
or by the Orchestrator reading its selector Skill and calling
`select_expert_squad`. Arbitrary request text must never be scanned by the host
to choose PowerPoint, spreadsheet, document, or PDF behavior.

## What mature Work skills actually contain

The investigated Office skills share a repeatable capability stack:

| Layer                 | Presentation example                                | Cross-format meaning                                            |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Discovery metadata    | Task mentions a deck or PowerPoint                  | Cheap, progressively disclosed capability discovery             |
| Workflow instructions | Narrative arc, layout route, audience-facing copy   | Domain judgment that belongs in the Skill                       |
| Runtime               | JavaScript artifact library and bundled Node.js     | Deterministic file authoring, not prose pretending to be a file |
| References            | API docs, template rules, style guidance            | On-demand technical and editorial knowledge                     |
| Assets                | Layout library, design tokens, previews             | Reusable, inspectable design inputs                             |
| Inspection            | Master/layout/slide inspection                      | Preserve and edit existing artifact structure                   |
| Rendering             | Render every slide/page/sheet                       | Observe the real deliverable                                    |
| Mechanical checks     | Overflow, clipping, formula/value, form-tree checks | Format-specific correctness beyond visual appearance            |
| Visual review         | Inspect every rendered output and iterate           | User-visible quality acceptance                                 |
| Provenance            | Source blocks/notes and file citations              | Traceable claims and downloadable output                        |

The critical lesson is that a `SKILL.md` alone is insufficient. A useful Work
capability is `Skill + runtime + resources + renderer + verifier + publisher`.

## Current OpenCorvus capability and gaps

### Capabilities already present

| Existing owner          | Useful current behavior                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Skill.Info`            | Discovers filesystem Skills, exposes metadata/content, declares required tools, supported platforms, and explicit mounted Agents.   |
| `SkillMount`            | Resolves the session-effective mounted Skill set against the active profile, Agent, tools, permissions, and platform.               |
| Expert-squad manifest   | Declares Agent prompts, Skill refs, package tools, MCP servers/tools/prompts/resources, and scheduler/worker capability projection. |
| `PromptProfileResolver` | Is the correct single projection owner for active package capabilities.                                                             |
| Task attachments        | Carry source decks, templates, data, documents, images, and PDFs into the real Task request.                                        |
| Artifact tools/catalog  | Publish and discover durable Task evidence and project files.                                                                       |
| Work route              | Sends an explicit Work request into the existing Task workflow.                                                                     |

### Confirmed gaps

| Gap                               | Evidence and impact                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No Office authoring runtime       | Repository dependencies contain no PowerPoint, Word, spreadsheet, or PDF authoring stack owned by OpenCorvus. A Skill cannot produce a reliable binary deliverable without one.                        |
| No Work artifact package          | Current project expert squads focus on coding/frontend/review scenarios; none projects Office artifact Skills, tools, templates, or reviewers.                                                         |
| No artifact-kind QA protocol      | Existing visual acceptance is web-preview-specific. It cannot prove slide overflow, Word pagination, spreadsheet formula/value integrity, or PDF form-tree correctness.                                |
| No final-deliverable contract     | Generic Artifact publication can record files, but there is no typed `work_deliverable` value defining primary file, format, previews, source lineage, verification results, and user-facing filename. |
| No Office preview surface         | Overlay can list/download files, but it does not yet give a Task-scoped rendered contact sheet/page/sheet preview for office artifacts.                                                                |
| No portable dependency resolution | Codex Work skills obtain a versioned bundled runtime from their host. OpenCorvus has no equivalent runtime manifest/resolver for document work.                                                        |

## Licensing boundary

The installed Codex presentation/spreadsheet Skills use
`@oai/artifact-tool@2.8.33`, but its installed package is marked `private` and
its license permits only internal evaluation/testing; it explicitly forbids
production, commercial, copying, modification, and distribution without
permission.

Therefore OpenCorvus must not vendor, copy, depend on, or reproduce the bundled
OpenAI artifact runtime or Codex Grid assets. The useful reference is the
**architecture and QA discipline**, not the proprietary implementation.

## Recommended architecture

### 1. One scenario package

Create `.opencorvus/expert-squads/work-artifacts/` as the only Work-domain
capability source:

```text
.opencorvus/expert-squads/work-artifacts/
├── expert-squad.jsonc
├── README.md
├── selector.md
├── agents/
│   ├── orchestrator/system.md
│   ├── work-researcher/system.md
│   ├── presentation-author/system.md
│   ├── document-author/system.md
│   ├── spreadsheet-author/system.md
│   ├── pdf-author/system.md
│   └── work-artifact-reviewer/system.md
├── skills/
│   ├── presentations/SKILL.md
│   ├── documents/SKILL.md
│   ├── spreadsheets/SKILL.md
│   └── pdf/SKILL.md
├── tools/
│   └── work-artifact.ts
└── references/
    ├── presentation-style.md
    ├── document-style.md
    ├── spreadsheet-quality.md
    ├── pdf-quality.md
    └── source-citation.md
```

The package should not define a new workflow engine. It supplies scenario
prompts/capabilities to the existing Task scheduler and publishes typed
artifacts through existing Artifact tools.

### 2. One typed runtime service

Add an OpenCorvus-owned `WorkArtifactRuntime` abstraction with one configured
implementation for each release. Expose narrow typed tools rather than a broad
shell recipe:

| Tool                    | Purpose                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `work_artifact_inspect` | Read existing PPTX, DOCX, XLSX, or PDF structure and return a bounded typed inventory.    |
| `work_artifact_render`  | Render a declared artifact/range into Task-scoped PNG evidence.                           |
| `work_artifact_verify`  | Run format-specific structural and visual checks and return a typed result.               |
| `work_artifact_publish` | Publish the verified final file and preview resources as one `work_deliverable` Artifact. |

Authoring remains code execution under the format Skill because the author needs
the full mature library surface. The runtime tools own dependency discovery,
rendering, verification, and publication so every Skill uses the same Host
contract.

The first production runtime should use distributable mature components:

| Format | Authoring                                                 | Render/inspection                                                                      |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| PPTX   | PptxGenJS                                                 | LibreOffice Impress to PDF, Poppler to PNG, plus OOXML overflow/placeholder inspection |
| DOCX   | `python-docx`                                             | LibreOffice Writer to PDF/PNG plus OOXML structural checks                             |
| XLSX   | ExcelJS                                                   | LibreOffice Calc to PDF/PNG plus formula/value/style inspection                        |
| PDF    | ReportLab for creation and `pypdf` for inspection/editing | Poppler rendering plus PDF object/form validation                                      |

PPTX means PowerPoint Open XML Presentation; DOCX means Word Open XML
Document; XLSX means Excel Open XML Workbook; OOXML means Office Open XML.

This is not a fallback list. Implementation must select and package one
authoring owner per format in the runtime manifest. Unsupported operations fail
visibly instead of switching libraries.

### 3. One runtime manifest

Add a versioned, package-owned manifest rather than hardcoded machine paths:

```jsonc
{
  "schema_version": 1,
  "runtime_version": "1",
  "node": {
    "package_refs": {
      "pptx": "pptxgenjs",
      "xlsx": "exceljs",
    },
  },
  "python": {
    "package_refs": {
      "docx": "python-docx",
      "pdf_read": "pypdf",
      "pdf_write": "reportlab",
    },
  },
  "renderers": {
    "office": "libreoffice",
    "pdf": ["pdftoppm", "pdfinfo"],
  },
}
```

The packaged OpenCorvus payload owns the resolved executable and library
locations. Project package prompts never contain absolute host paths.
Capabilities missing from the installed runtime appear as explicit unavailable
tool/Skill reasons; they do not silently use system software.

### 4. One deliverable schema

Publish a canonical `work_deliverable` value:

```jsonc
{
  "schema_version": 1,
  "format": "pptx",
  "title": "Quarterly business review",
  "primary_resource_ref": "artifact://...",
  "preview_resource_refs": ["artifact://..."],
  "source_artifact_locators": [],
  "verification": {
    "structural": "passed",
    "render": "passed",
    "visual_review": "passed",
  },
  "inspection_scope": {
    "units": 12,
    "reviewed_units": 12,
  },
}
```

The Task Artifact Catalog remains the canonical discovery surface. Do not add a
parallel "Work files" database. The Overlay may render a specialized preview
for `work_deliverable`, but it reads the same Catalog entry and resource refs.

### 5. Format-specific verification

| Format | Required acceptance                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PPTX   | Every slide rendered and visually inspected; no unintended overlap, clipping, unresolved placeholder, unreadable type, or broken image crop; source notes present for researched claims/assets. |
| DOCX   | Every page rendered and inspected; pagination, styles, headings, tables, headers/footers, comments/tracked changes, and accessibility structure checked as applicable.                          |
| XLSX   | Formulas and cached/visible values inspected; number/date formats, merged cells, widths, frozen panes, print ranges, and representative rendered ranges checked.                                |
| PDF    | Every page rendered; text/fonts/images checked; AcroForm field tree and widget appearances verified for forms; flattened output proves widgets/field tree are absent.                           |

Visual review must be performed by an image-capable reviewer Agent using the
fresh Task-scoped render resources. Command success or file existence is not
acceptance.

## Skill design rules

Each format Skill should:

1. State exactly what it does and when to use it in metadata.
2. Declare the required runtime tools and supported platforms.
3. Route between new artifact, existing artifact edit, and template-following.
4. Preserve the source artifact and export a new file unless the user requests
   in-place editing.
5. Read only the references required for the selected operation.
6. Use organization/project brand templates when supplied; otherwise use a
   clean-room OpenCorvus template pack.
7. Keep external claim and asset provenance in the artifact itself when the
   format supports it, and always in `work_deliverable.source_artifact_locators`.
8. Render, inspect, repair, re-render, verify, and only then publish.
9. Fail visibly when the runtime or renderer is absent.

## Work-mode user experience

### Composer

- `Code | Work` remains the only mode switch.
- Work requests can reference `@work-artifacts` explicitly.
- The general Work Orchestrator can select `work-artifacts` through the visible
  selector Skill when the request clearly requires a finished document,
  presentation, spreadsheet, or PDF.
- The `@` catalog shows the real Squad and Skill types; it does not invent a
  "Work Skill" hybrid type.

### Task

- Source files and templates appear as real attachments.
- The conversation shows the authoring and review Agents as normal visible
  participants.
- The final Task message links to the canonical downloadable artifact.
- The Artifact summary shows one primary deliverable with format, page/slide/
  sheet count, verification state, and preview.

### Preview

Phase 1 can use Task-scoped rendered PNG previews in the existing Artifact
workbench. A later specialized viewer is acceptable only as a projection of the
same `work_deliverable`; it must not own a second file or verification state.

## Implementation order

### Phase 0 — Acceptance benchmark

Before product code, define four representative fixtures:

1. create a 10–12 slide sourced presentation;
2. edit a template-based presentation without flattening its structure;
3. create a formula-bearing workbook with a summary chart;
4. create a paginated document and export/validate a PDF.

Each fixture needs expected structure, rendered references, source provenance,
and a reviewer checklist. These are artifact benchmarks, not prompt-string
tests.

### Phase 1 — PPTX vertical slice

PowerPoint is the best first slice because it exercises the entire architecture:
attachments, templates, code execution, images, fonts, rendering, per-unit
visual QA, citations, final publication, and preview.

Deliver:

- `work-artifacts` package and selector;
- presentation Skill and author/reviewer overlays;
- packaged Node.js authoring dependencies;
- LibreOffice/Poppler renderer discovery;
- typed inspect/render/verify/publish tools;
- `work_deliverable` schema;
- Artifact Catalog presentation card and contact-sheet preview;
- real end-to-end benchmark with downloadable PPTX and inspected screenshots.

### Phase 2 — DOCX and PDF

Reuse the runtime/publisher contract, add page-based verification, document
style presets, tracked-change/comment handling, PDF export, and form semantics.

### Phase 3 — XLSX

Add formula/value inspection, spreadsheet rendering ranges, chart/data
consistency checks, and workbook-specific Artifact metadata.

### Phase 4 — Connectors and organizational templates

Connector access belongs in plugin/MCP configuration, not in format Skills:

- Google Drive for native Google Docs/Slides/Sheets import;
- SharePoint/OneDrive-style storage through an authorized connector;
- Box or other document stores when explicitly installed;
- organization brand/template packages as project resources.

Connector installation is optional product integration. Local Office artifact
creation must remain complete without a cloud connector.

## Configuration sketch

The expert-squad manifest should project only the capability needed by each
Agent. Exact Agent IDs should be introduced with their prompt files and tests;
illustrative shape:

```jsonc
{
  "schema_version": 1,
  "id": "work-artifacts",
  "label": "Work Artifacts",
  "selector": {
    "summary": "Create, edit, render, verify, and publish presentations, documents, spreadsheets, and PDFs.",
    "selection_guidance": "Select when the requested outcome is a finished office artifact rather than source-code delivery.",
    "instructions": "selector.md",
  },
  "capability_projection": {
    "scheduler": {
      "base_role": "orchestrator",
      "inherit_base_tools": true,
      "package_skill_refs": [
        "work-artifacts/shared/presentations",
        "work-artifacts/shared/documents",
        "work-artifacts/shared/spreadsheets",
        "work-artifacts/shared/pdf",
      ],
    },
    "agents": {
      "presentation-author": {
        "base_role": "general",
        "package_skill_refs": ["work-artifacts/shared/presentations"],
        "package_tool_refs": ["work-artifacts/shared/work-artifact"],
      },
      "work-artifact-reviewer": {
        "base_role": "general",
        "package_tool_refs": ["work-artifacts/shared/work-artifact"],
      },
    },
  },
}
```

The final implementation must use the current manifest schema exactly; this
sketch expresses ownership, not a copy-ready schema promise.

## Tests and acceptance

### Contract tests

- registry accepts the package and rejects undeclared Skill/tool refs;
- active/inactive package projection stays isolated;
- each Skill is mounted only to declared Agents;
- missing runtime dependencies produce an explicit disabled/error result;
- `work_deliverable` rejects foreign, missing, unrendered, or unverified
  resource refs;
- final publication uses the existing Artifact Catalog and creates no second
  file registry.

### Runtime tests

- deterministic artifact creation from fixture input;
- existing artifact/template inspection and edit;
- renderer invocation and output enumeration;
- negative cases for corrupt files, missing fonts, broken images, overflow,
  formula errors, and invalid PDF fields;
- platform packaging tests for macOS, Windows, and Linux;
- child process termination and temporary-resource cleanup.

### Real end-to-end acceptance

- start an isolated OpenCorvus test service;
- submit a Work Task with real source attachments;
- observe real Agent/tool messages;
- produce the final binary under the Task artifact root;
- render every relevant unit;
- inspect fresh screenshots;
- publish and reopen the Catalog entry;
- download the artifact and inspect it with an independent parser;
- run a second reviewer pass against the final file and rendered evidence.

Mocked tool output, string screenshot refs, fixture-only file names, or a
successful build are not end-to-end acceptance.

## Priority recommendation

Build the PPTX vertical slice first, but design the runtime and
`work_deliverable` schema as format-neutral from day one. This gives the
shortest path to a visibly stronger Work mode without turning the first release
into four partially working generators.

The first release should be considered complete only when a user can choose
Work, attach source material/template, receive a visually reviewed downloadable
PPTX, preview its rendered slides in the Task, and find the same file in the
canonical Artifact Catalog.
