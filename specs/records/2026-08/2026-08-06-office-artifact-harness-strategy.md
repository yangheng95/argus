# Office Artifact Harness Strategy

Status: proposed architecture, independently audited on 2026-08-06.

## Recall

### User request and acceptance

Investigate how WorkBuddy and comparable personal AI assistants generate PPTX,
DOCX, XLSX, and adjacent office materials; determine which products are usable
or embeddable; identify the strongest open-source harness, algorithm, or Skill
alternative; and produce one coherent integration plan rather than accumulating
format-specific Skills and frameworks. Independent agents must converge on the
correct route.

The result must distinguish facts from inference, cover the full market, explain
the production lifecycle, select exactly one authoring runtime and ownership
boundary, define licensing/security/provenance/benchmarks/rollout, and state
what is not yet production-proven.

### Hard constraints

- No separate DOCX, PPTX, XLSX, and PDF generation Skills.
- No parallel format libraries, compatibility aliases, or fallback author.
- Do not install or reverse engineer a closed personal assistant.
- Do not expose OfficeCLI installer, updater, resident process, Model Context
  Protocol (MCP) server, plugins, raw Extensible Markup Language (XML), shell,
  arbitrary paths, or unrestricted commands.
- User Interface (UI) review uses real rendering and human inspection, not
  automated visual assertions or screenshot baselines.
- Preserve canonical Attachments, Task Artifacts, Resolver ownership, natural
  messages, and model-directed flow; add no host workflow state machine.

### Repository evidence

Read current architecture 04, 09, 15, 17, and 99; the 2026-07-29 Work artifact
and Office capability records; Work harness; presentation runtime/tools/Skill;
ConversationCapability; PromptProfileResolver; Interactive Artifact schemas;
Task/Engine Artifact contracts; and the runtime binary build script.

Relevant whole-repository searches:

~~~text
rg -n "work_office_|OfficeCLI|officecli|presentation@1|PPTX|DOCX|XLSX" packages specs expert-squads
rg -n "WORK_DEFAULT_CAPABILITY_ASSIGNMENT|WORK_OFFICE_TOOL_IDS|ConversationCapability|work-presentations" packages/opencorvus/src specs/current
rg -n "PromptProfileResolver|capability_projection|default_tool_refs|default_skill_refs|package_tool_refs" packages expert-squads specs/current
rg -n "EngineArtifactEnvelopeSchema|source_artifact_locators|TaskArtifactRef|resources" packages/opencorvus/src packages/plugin/src
rg --files packages/opencorvus/src | rg "expert-squad|artifact|skill|mcp|work-office"
rg --files expert-squads
~~~

### Independent agents

Three one-layer, read-only audits independently converged:

1. Market: WorkBuddy and other general assistants are peer products, not
   document engines. Native office agents have the best fidelity but are
   platform-locked. OfficeCLI was the only open three-format candidate.
2. Open source: OfficeCLI is best-fit but young, contributor-concentrated, lacks
   credible public fidelity evidence, has an overly broad install surface, and
   relies on licensed Microsoft Word for its Windows native Word PDF path.
3. Architecture: OpenCorvus already pins OfficeCLI v1.0.143 across eight
   targets and implements new-PPTX end to end. Copying the slice for DOCX/XLSX
   would create three sources; replace it with one platform-default harness.

One audit initially placed the runtime in an expert package. Repository evidence
selects platform ownership because Direct Work activates no expert squad while
Task workers use PromptProfileResolver. Both may project the same platform
default capability. Expert squads may orchestrate it but cannot copy it.

## Executive decision

Adopt one platform-default OfficeArtifactHarness, backed by a fixed and audited
OfficeCLI build, as the only writer/mutator for Office Open XML (OOXML): DOCX,
XLSX, and PPTX.

- OpenCorvus owns research, facts, citations, narrative, permissions, typed
  tools, lineage, review, and delivery.
- OfficeCLI owns deterministic inspection, OOXML mutation, serialization,
  template binding, structural checks, and preview rendering.
- One umbrella office-artifacts Skill teaches use of those typed tools. It is
  guidance, not a second generator.
- Direct Work projects it through ConversationCapability; Task agents project
  the same resources through PromptProfileResolver.
- A future Office Production Expert Squad may own a domain workflow, but no
  runtime, private Office Skill, format library, or artifact store.

OfficeCLI is selected, not declared production-proven. Expansion beyond the
current bounded new-PPTX slice requires fixed-build enterprise-corpus evidence
in real Microsoft Office. That is evidence for implementation acceptance, not
a runtime gate.

## 1. Scope

Primary editable artifacts are DOCX narrative documents, XLSX calculation/data
workbooks, and PPTX presentations.

- Portable Document Format (PDF) is derived delivery/review output. Native PDF
  forms, redaction, signing, optical character recognition, and arbitrary PDF
  authoring are separate.
- Comma-Separated Values (CSV) and Tab-Separated Values (TSV) are interchange,
  not styled workbooks.
- Google/Tencent/Microsoft cloud documents belong to connectors, not the local
  writer.
- HTML/Markdown are sources or previews, never substitutes for Office files.
- Images/charts/media are canonical embedded assets, not separate author Skills.

## 2. How successful systems generate files

~~~text
intent and source collection
  -> fact/citation snapshot
  -> format-native plan and template selection
  -> deterministic object operations
  -> native editable file
  -> structural and semantic validation
  -> complete render/open/recalculate observation
  -> source-level repair and full re-render
  -> immutable delivery plus provenance
~~~

The Large Language Model (LLM) is strongest at intent, synthesis, hierarchy,
storyline, semantic mapping, and revision. Deterministic software is strongest
at package relationships, dimensions, formulas, style inheritance, masters,
serialization, and reproducibility.

### Native-suite agents

Microsoft 365 Copilot, Google Workspace Gemini, WPS AI, Tencent Docs, and Zoho
Zia operate their suite-native object models and inherit templates, comments,
history, recalculation, fonts, and rendering. Their fidelity advantage comes
from owning the editor, not a reusable algorithm.

Sources: <https://learn.microsoft.com/en-us/microsoft-365/copilot/wordexcelppt-agents>,
<https://support.google.com/docs/answer/17111393?hl=en>,
<https://support.google.com/docs/answer/16959434?hl=en>,
<https://www.wps.cn/article/wps-ai-how-to-use-beginner-guide.html>, and
<https://www.zoho.com/workplace/help/ai-in-zoho-workplace.html>.

### General sandbox agents

WorkBuddy, Claude, ChatGPT Work, Manus, Skywork, Genspark, Notion AI, and
OfficeClaw plan, gather sources, call Skills/code in a sandbox, inspect output,
and return files. Integrating one beneath OpenCorvus would add a second planner,
model router, sandbox, permission system, and conversation protocol.

Sources: <https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude>,
<https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work>,
<https://manus.im/docs/features/slides>, and
<https://skywork.ai/desktop/en/index.html>.

### Presentation-first engines

Gamma, Beautiful.ai, Canva, Plus AI, Pitch, Prezi, Presentations.ai, and Baidu
Wenku AI PPT use proprietary layout grammars/templates/assets, then export.
Exports may alter fonts, animation, transitions, or objects. They benchmark
layout and revision, not complete office authoring. Tome Slides shutting down
in 2025 illustrates supplier lifecycle risk.

Sources: <https://developers.gamma.app/>,
<https://help.gamma.app/en/articles/8022861-what-s-the-easiest-way-to-export-my-gamma>,
<https://support.beautiful.ai/hc/en-us/articles/30629528652685-Exporting-your-slides-and-presentations>,
<https://www.canva.com/create/ai-presentations/>, and
<https://tome.app/help/en/articles/10744234-tome-slides-is-sunsetting-on-april-30th-2025>.

### Infrastructure and libraries

Carbone merges templates; Pandoc converts markup; ONLYOFFICE/LibreOffice are
full suites; Open XML SDK, Apache POI, python-docx, openpyxl, python-pptx,
PptxGenJS, docx.js, and ExcelJS are format libraries. Combining them makes
OpenCorvus maintain multiple models, templates, renderers, and repair loops.

## 3. WorkBuddy deep dive

This report evaluates Tencent WorkBuddy, not the unrelated open-source
work-buddy/Claude Code/Obsidian project.

Tencent describes WorkBuddy as an office workstation that plans and executes
over local files, web, documents, spreadsheets, presentations, and data. The
official Office Document Suite exposes separate PDF/DOCX/PPTX/XLSX capabilities
for reading, generation, cleanup, formulas, charts, and export. Tencent Docs
objects are directly created/read/edited through Tencent native services.

Verified conclusion:

1. Tencent Docs uses Tencent native online objects/editing.
2. Local files are delegated to workspace format capabilities.
3. The actual local serializer is not public; naming a specific library would
   be speculation.

Sources: <https://www.workbuddy.cn/docs/workbuddy/Overview>,
<https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/WorkBuddy-Zero-Cost-Skill-Top-10/Office-Document-Suite>,
<https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Knowledge-Base/Tencent-Doc>,
and unrelated namesake <https://docs.work-buddy.ai/>.

WorkBuddy is usable as an end-user/procurement product, not an embedded engine:

- No supported local Office authoring Software Development Kit (SDK) or public
  embedding API was found in reviewed official material.
- Its agreement restricts reverse engineering, extraction, unauthorized
  interoperating components, and competing-product use of outputs.
- Its privacy policy permits third-party model processing and remote
  input/output retention up to 14 days.
- It is a peer orchestrator with models, Skills, connectors, permissions,
  workspace, and task lifecycle.

Sources: <https://www.workbuddy.ai/document/term> and
<https://www.workbuddy.ai/document/privacy-policy>.

## 4. Market map

| Class | Products | Mechanism | OpenCorvus role |
|---|---|---|---|
| Native suites | Microsoft 365 Copilot; Gemini Workspace; WPS AI; Tencent Docs; Feishu; DingTalk; iFlytek; Zoho Zia | Native suite objects | Benchmark/connector |
| General agents | Claude; ChatGPT Work; WorkBuddy; Manus; Skywork; Genspark; Notion AI; OfficeClaw | Planner+sandbox+Skills | Exclude second orchestrator |
| Presentation design | Gamma; Canva; Beautiful.ai; Plus AI; Pitch; Prezi; Presentations.ai; Baidu Wenku | Proprietary layout then export | Algorithm benchmark |
| Template automation | Carbone and commercial generators | Data-to-template merge | Exclude primary runtime |
| Full open suite | LibreOffice; ONLYOFFICE | Desktop/server editor/converter | Independent oracle |
| Format libraries | Open XML SDK; Apache POI; python-docx; openpyxl; python-pptx; PptxGenJS; docx.js; ExcelJS | Per-format objects | Do not assemble |
| Unified open CLI | OfficeCLI | One structured DOCX/XLSX/PPTX family | Selected sole author |

This is a landscape, not an installation list. Only one row is selected for
authorship.

## 5. Open-source assessment

| Candidate | Strength | Limitation | Decision |
|---|---|---|---|
| OfficeCLI 1.0.143 | Unified author/edit/query/merge/dump/batch/validate/render | Young; weak fidelity evidence | Select conditionally |
| ONLYOFFICE Builder | Mature unified suite | Heavy; watermark/commercial embedding concerns | Do not integrate |
| LibreOffice Universal Network Objects (UNO) | Mature suite/conversion | Complex, large, not Agent-native | Oracle only |
| Open XML SDK | Mature MIT OOXML API | No layout/recalc/conversion | Inspection reference |
| Apache POI | Mature Java objects | Per-format; no native render | Exclude |
| Python/JavaScript format libraries | Mature individually | Three object/render stacks | Exclude |
| Carbone | Strong fixed templates | Not general authoring | Exclude |
| Pandoc/Typst | Mature text/PDF | Not editable full Office | Separate domains |
| Anthropic office Skills | Strong workflows | Proprietary per-Skill files | Cannot redistribute |
| Skywork Skills/MCP wrappers | Broad examples/transport | Fragmented; transport is not harness | Reject |
| Gotenberg | Mature Office-to-PDF | No source authoring | Optional oracle |
| Docling | Strong ingestion | No OOXML round trip | Future ingestion only |

References: <https://github.com/iOfficeAI/OfficeCLI>,
<https://api.onlyoffice.com/docs/document-builder/get-started/overview/>,
<https://api.onlyoffice.com/docs/document-builder/get-started/installing/>,
<https://api.libreoffice.org/>, <https://www.libreoffice.org/licenses/>,
<https://github.com/dotnet/Open-XML-SDK>,
<https://github.com/carboneio/carbone>,
<https://github.com/gotenberg/gotenberg>,
<https://docling-project.github.io/docling/usage/supported_formats/>, and
<https://github.com/anthropics/skills>.

### Why OfficeCLI is selected

It is the only evaluated open candidate with one self-contained runtime for all
three formats; structured JSON operations; read/create/edit/query/merge/dump/
batch/validate; shared template replacement; observable rendering; and
Apache-2.0 distribution without another agent/server/library collection.

OpenCorvus already pins v1.0.143 across eight target platforms with Secure Hash
Algorithm 256-bit (SHA-256) digests and uses it for new-PPTX creation,
inspection, validation, rendering, and delivery.

### Why it is not production-proven

- Repository created March 2026.
- Observed approximately 25,700 stars and 17 contributors, but contributions
  are overwhelmingly concentrated in one account.
- No credible public fidelity test/fixture/benchmark corpus found.
- README incorrectly describes LibreOffice as closed/paid.
- Installer/update/Skill/MCP surfaces are too broad and stateful.
- HTML preview is not Microsoft Office truth.
- Windows Word PDF backend invokes licensed Word and is not cross-platform.
- PDF is an exporter, not a forms/redaction/signing/recognition engine.

Native backend source:
<https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/src/officecli/Core/WordPdfBackend.cs>.

Decision: select OfficeCLI as sole candidate for fixed-source qualification;
do not call the upstream binary a proven production office engine.

## 6. Algorithms to absorb, not projects to install

1. Template retrieval and semantic slot mapping: inspect masters, layouts,
   styles, names, controls, placeholders, and examples; select the closest
   corporate template; bind typed facts/assets; preserve untouched structure.
2. Separate planning from serialization: the Agent resolves audience, sources,
   claims, calculations, citations, storyline, and structure; the runtime
   applies typed operations; the LLM never writes raw XML.
3. Canonical fact graph: numbers, dates, units, assumptions, conclusions, and
   citations have identities. Verified XLSX results become immutable facts
   before DOCX/PPTX binding.
4. Render-observe-revise: view every fresh page/slide and declared worksheet
   region, repair source operations, and fully rerender.
5. Constraint repair: correct overflow, clipping, density, margins, alignment,
   placeholders, contrast, formulas, units, and fonts in source objects.
6. Spreadsheet semantics: check dependencies/ranges, input/formula
   classification, dates, units, totals, cached versus real Excel values,
   names, charts, validations, and print areas.
7. Minimal-change round trip: preserve unknown OOXML parts/relationships,
   compare inventories, and open without repair prompts.
8. Provenance: record sources, assumptions, hard-coded values, fact/template/
   runtime/font digests, validation, render manifest, and reviewer decision.

Do not create a universal lossy document tree. Share an envelope for facts,
sources, assets, theme, template, provenance, and output identity, then use
native DocumentPlan, WorkbookPlan, and PresentationPlan bodies.

## 7. Selected OpenCorvus architecture

### Ownership

- Direct Work receives one office-artifacts Skill and typed tools through
  ConversationCapability.
- Task agents receive the same platform references only when an active expert
  package declares them through PromptProfileResolver.
- Chat/unrelated profiles receive nothing implicitly.
- Expert squads own prompts/workflows only, never runtime/private Office assets.
- Core remains generic process, Attachment, Task Artifact, Engine Artifact,
  permission, Skill, Tool, and projection infrastructure.

Direct Work and Task retain their canonical publishers while sharing one
runtime and delivery schema. No third Office artifact registry is created.

### Sole runtime and tool surface

The wrapper accepts canonical inputs only, calls fixed binaries without a
shell, uses discriminated format schemas, binds candidates to SHA-256, and
revalidates/rerenders the exact delivery digest.

One Skill exposes four operation tools:

~~~text
office_artifact_inspect
office_artifact_author
office_artifact_validate
office_artifact_deliver
~~~

Format is a discriminated property, not twelve format-operation tools. The
model chooses calls; the host stores no authoring state machine.

Microsoft Office/LibreOffice are isolated release oracles, never writers.
Gotenberg is only a possible terminal PDF oracle; Docling only possible source
ingestion. Neither belongs in the initial runtime.

Target structure:

~~~text
packages/opencorvus/src/office-artifact/
  schema/{plan,template,verification,delivery,error}.ts
  runtime/{officecli,process-sandbox,runtime-lock}.ts
  adapter/{document,workbook,presentation}.ts
  inspect/{ooxml-package,security,fonts}.ts
  render/manifest.ts
  publish/{conversation,task}.ts
packages/opencorvus/src/tool/office-artifact.ts
packages/opencorvus/src/skill/builtin/office-artifacts/
packages/opencorvus/runtime/officecli.lock.json
~~~

Current presentation-specific tools, work-presentations Skill, and implementation
are atomically replaced after positive behavior migrates. No aliases remain.

## 8. Contracts

The plan envelope contains version, locale, canonical sources, typed facts,
assets, theme, template digest, and one discriminated native format body.
Simple template values use OfficeCLI merge; structural duplication uses dump,
typed normalization, and batch. Unsupported required slots return typed errors,
never blank output.

The delivery envelope records plan/runtime/template digests, output format,
canonical primary reference/digest, render/verification references, sources,
fact snapshot, and font manifest. Direct Work publishes an immutable Attachment
on the same real assistant message; Task uses existing Task/Engine Artifacts.

## 9. Security and supply chain

- One lock manifest records version, platform asset, SHA-256, license, source
  commit, and Software Bill of Materials (SBOM).
- Build internally from fixed source after qualification; never run remote
  installers or user executable search paths.
- Set OFFICECLI_SKIP_UPDATE=1 and OFFICECLI_NO_AUTO_RESIDENT=1.
- Isolate temporary/configuration/cache/profile/locale/timezone/font paths;
  deny network and arbitrary filesystem access.
- Terminate complete process trees on cancellation, inactivity, or timeout.
- Reject traversal, duplicate/case-colliding ZIP entries, entities, external
  relationships, Visual Basic for Applications (VBA), Object Linking and
  Embedding (OLE), ActiveX, Dynamic Data Exchange (DDE), external workbook
  links, encryption, executables, and resource bombs.
- Make missing fonts explicit and revalidate the exact delivery digest.

Typed errors cover runtime unavailable, unsupported operation, invalid/unsafe
package, template binding, formula evaluation, missing fonts, structural
validation, rendering, digest mismatch, visual review required, and cancellation.

## 10. Qualification corpus

At least 30 realistic enterprise artifacts:

- DOCX: Chinese/Japanese/Korean, English, Right-to-Left (RTL), headings, table
  of contents, sections, headers/footers, notes/citations, tables/images,
  comments, tracked changes, controls, mail merge, template round trip.
- XLSX: multiple sheets, names, formulas, arrays, dates/currencies, formatting,
  validation, filters, print, charts/pivots, dependencies/reconciliation, real
  Excel recalculation, hidden/protected structures, external-link rejection.
- PPTX: masters, layouts, themes, placeholders, notes/sections, editable
  objects, ratios, multilingual fonts, dense layouts, template round trip,
  explicit unsupported media/animation behavior.
- Bundle: one workbook is calculation authority; prove consistent facts, units,
  dates, sources, and template revision across XLSX, DOCX, PPTX, and PDF.

Each applicable artifact receives independent package/security checks,
OfficeCLI validation/issues, complete fresh visual review, visible licensed
Word/Excel/PowerPoint open without repair, real Excel recalculation, optional
isolated LibreOffice cross-render, before/after edit inventory, and canonical
digest/lineage/verification. This is interactive review, not UI automation.

## 11. Implementation sequence

1. Consolidate current PPTX: one runtime lock, update/profile/network/font
   isolation, shared schemas, migrated positive behavior, deleted old identities.
2. Add template/minimal-change editing: safe inspect, merge, dump,
   normalization, batch, typed fact/asset/theme binding.
3. Add DOCX inside the same harness, with every-page and real Word review.
4. Add XLSX inside the same harness, with calculation authority and real Excel
   recalculation.
5. Add cross-format bundles and exact Task projection. Add an Office Production
   Expert Squad only after a persistent workflow is proven; it remains a pure
   orchestrator.

## 12. Explicit exclusions

No WorkBuddy/peer assistant under OpenCorvus; no reverse engineering; no
separate format Skills; no parallel author libraries/suites/SaaS fallbacks; no
OfficeCLI Skill/MCP/installer/updater/resident mode; no universal lossy Domain-
Specific Language (DSL); no raw XML/commands/paths/URLs; no preview masquerading
as Office output; no unattended Office daemon; no claim that OfficeCLI preview
equals Microsoft Office; no UI automation or pixel-difference tests.

## 13. Decision record

| Question | Decision | Reason |
|---|---|---|
| Embed WorkBuddy? | No | No supported SDK found; peer orchestrator; contract/data constraints |
| Use WorkBuddy at all? | Benchmark/procurement only | Strong reference, closed engine |
| Multiple Office Skills/libraries? | No | Multiple object/template/render truths |
| OfficeCLI production-proven? | No | Young, concentrated, weak fidelity evidence |
| Best single candidate? | OfficeCLI | Only compact open three-format structured author/edit surface |
| Ownership? | Platform-default harness | Work and Task project one implementation |
| Umbrella Skill a second engine? | No | Guidance for same typed tools/runtime |
| Office/LibreOffice fallback authors? | No | Release oracles only |
| PDF a fourth author? | No | Derived delivery/review |
| Unsupported behavior? | Typed failure and root-cause repair | No alternate generator |

## 14. Final recommendation

Proceed with fixed-source OfficeCLI qualification and atomically replace the
presentation-only slice with a platform-default OfficeArtifactHarness. Do not
add another office framework or per-format Skill while this route is active.

Accept only after native template editing, minimal-change round trip, formula
correctness, complete visual review, real Office open/recalculation, immutable
lineage, and cross-format consistency succeed on the enterprise corpus.

Honest status: bounded new-PPTX creation is usable. General DOCX/XLSX/PPTX
editing has a selected architecture but is not production validated.

## 15. Primary sources

- WorkBuddy: <https://www.workbuddy.cn/docs/workbuddy/Overview>,
  <https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/WorkBuddy-Zero-Cost-Skill-Top-10/Office-Document-Suite>,
  <https://www.workbuddy.ai/document/privacy-policy>,
  <https://www.workbuddy.ai/document/term>.
- Commercial: <https://learn.microsoft.com/en-us/microsoft-365/copilot/wordexcelppt-agents>,
  <https://support.google.com/docs/answer/17111393?hl=en>,
  <https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude>,
  <https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work>,
  <https://developers.gamma.app/>,
  <https://www.canva.com/create/ai-presentations/>.
- Open source: <https://github.com/iOfficeAI/OfficeCLI>,
  <https://github.com/iOfficeAI/OfficeCLI/releases/tag/v1.0.143>,
  <https://api.onlyoffice.com/docs/document-builder/get-started/overview/>,
  <https://api.libreoffice.org/>, <https://www.libreoffice.org/licenses/>,
  <https://learn.microsoft.com/en-us/office/open-xml/open-xml-sdk-design-considerations>,
  <https://github.com/gotenberg/gotenberg>,
  <https://docling-project.github.io/docling/usage/supported_formats/>,
  <https://github.com/anthropics/skills>.
- Research benchmarks: OfficeBench <https://arxiv.org/abs/2606.10956> and
  PPTArena <https://arxiv.org/abs/2512.03042>.
