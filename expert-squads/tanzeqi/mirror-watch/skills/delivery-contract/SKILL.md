---
name: mirror-watch-delivery-contract
description: Use for every Mirror Watch research, expert survey, persona survey, aggregation, and report task.
---

# Mirror Watch delivery contract

The explicit AInvest product question is the variable run input. The installed self-contained package owns the authoritative persona JSON, iFind configuration, and report HTML template as immutable compiled assets. Callers never pass their paths or contents. The canonical project-relative output paths below are the single path source for this package. Do not search for a package asset path, ask the user to choose one, infer a filename, accept an alternate path, or treat a missing parent directory as ambiguity. The package contains no seed mode, demo source, alternative runner, compatibility alias, or inferred configuration.

## Canonical project paths

- persona authority: exact JSON published by `mirror-watch/shared/personas` as `mirror-watch/persona-authority` in the current Task Catalog and validated through the same parser compiled into `mirror-watch/shared/aggregate-report`;
- iFind configuration: compiled into `mirror-watch/shared/ifind-search`;
- report template: compiled into `mirror-watch/shared/aggregate-report`;
- recommendation Markdown: `dashboard/data/ainvest-h2-feature-recommendations.md`;
- inline SVG Gantt HTML: `dashboard/data/ainvest-h2-gantt-chart.html`;
- canonical agent survey Markdown: `dashboard/data/ainvest-h2-feature-survey-agent.md`;
- human survey HTML: `dashboard/data/ainvest-h2-feature-survey.html`;
- Denis expert Markdown: `dashboard/data/process_answer/agent-denis-globa.md`;
- Denis expert HTML: `dashboard/data/process_answer/agent-denis-globa-survey.html`;
- Denis expert data module: `dashboard/data/process_answer/data/agent-denis-globa-survey.data.js`;
- Oleg expert Markdown: `dashboard/data/process_answer/agent-oleg-mukhanov.md`;
- Oleg expert HTML: `dashboard/data/process_answer/agent-oleg-mukhanov-survey.html`;
- Oleg expert data module: `dashboard/data/process_answer/data/agent-oleg-mukhanov-survey.data.js`;
- each persona vote: `dashboard/data/process_answer_aime/<exact persona.name>.json`;
- final report HTML: `dashboard/reports/ainvest-h2-report.html`.

The `mirror-watch/aggregate-report` Catalog Artifact published by `mirror-watch/shared/aggregate-report` is the canonical aggregation JSON. It contains the schema version, exact vote counts, report path and digest, scores, segment matrices, bundles, quotes, exact selected source provenance, and the immutable HTML Task Artifact resource. The ordinary package-tool result is only a compact publication receipt and a Turn observation, not inter-Agent transport. Do not create a parallel aggregation JSON file or recompute those values elsewhere.

Each dynamic worker's authority ends after it writes and rereads its exact owned final resources, publishes one namespaced canonical JSON Artifact through `artifact_publish` when it has no typed domain-output or package-tool publisher by setting `payload_json` to strict JSON text with unique object keys, and sends a visible final assistant message that naturally narrates work, limitations, and blockers without serving as durable evidence transport. Verification and contract proof are read-only: use `read` to inspect current bytes. Never call `write`, `edit`, or `apply_patch` merely to verify alignment, repeat existing content, or create a no-op. Mutate an owned resource after verification only when you identify a concrete contract mismatch, and the replacement must differ from the current bytes; otherwise describe the verified facts in the visible final message without another mutation. Repair exactly one resource and one concrete mismatch per mutation call. Immediately before that call, `read` the exact current target region and copy its current bytes into the edit or patch context; never batch another resource, unchanged hunk, or speculative context into the same repair. After a successful mutation, reread that resource before deciding whether another distinct repair is necessary. A worker must not stage files, create a Git commit, push, or ask the user whether to perform version-control actions; repository delivery remains outside the worker contract.

## Research contract

Produce exactly ten features in F01-F10 order. A feature identity is the pair of its code and exact title. Under each `### FNN. <exact title>` heading inside `## 10 个推荐功能`, use these four exact bold field labels once and in this order: `**时间节点**`, `**做什么**`, `**竞品参照**`, `**AInvest 差异化**`. Inside `竞品参照`, follow the source template with a named competitor capability and its exact relevant HTTPS URL from a visible iFind row. When no visible iFind row verifies that fact, write `数据缺失 (N/A)` and state the unverified fact without inventing a URL or capability. Preserve the feature title, timing, action, and differentiation semantics across recommendations, survey, Gantt data, and competitive matrix. N/A is the source algorithm's explicit missing-data value, not an alternate provider, seed, or inferred substitute.

The recommendation Markdown compiles the source `feature-recommendations` template into this exact section order; it is not just ten standalone feature headings:

1. one `## ... 现有产品线 ...` section with a Markdown table whose headers are exactly `产品`, `URL`, `现状`; a verified row uses the exact relevant AInvest HTTPS URL supplied by live iFind evidence, while an unverified row exposes `数据缺失 (N/A)` rather than a generated URL;
2. one `## H2 关键时间节点` section with a table whose first three headers are `日期`, `事件`, `与 AInvest 的关联`, containing at least three concrete H2 planning events that also drive Gantt `keyEvents`;
3. one `## 10 个推荐功能` section containing `### F01. <exact title>` through `### F10. <exact title>` in order and the complete feature-local contract above;
4. one `## 竞品功能全景对照` section with exactly ten feature rows and the ordered columns `功能方向`, `TradingView`, `Yahoo Finance`, `AInvest 现状`, `本清单推荐`; each row contains its F code exactly once, and the four evidence/recommendation cells copy substantive text verbatim from that feature's `竞品参照`, `AInvest 差异化`, or `做什么` rather than generic availability marks;
5. one `## 总结` section with exactly one line for each `事件驱动型` (`#3B80FF`), `平台能力型` (`#735DD6`), and `留存传播型` (`#00CCCC`), classifying every F01-F10 code exactly once.

The feature headings are level three because they live inside the single `10 个推荐功能` section. Do not rename a required section to `推荐总览`, omit a table, append the structural sections after F10 out of order, or use the legacy template's old color values.

The three research categories are stable and share one AInvest chart-token mapping across recommendation summary and Gantt data: event `#3B80FF`, platform `#735DD6`, retention `#00CCCC`.

The research deliverables are:

- one recommendation Markdown document;
- one self-contained HTML document with a substantive inline SVG Gantt chart;
- one agent survey Markdown document that contains the complete ordered F01-F10 feature body with each feature's exact title and the source template's `时间`, `做什么`, and `差异化` fields, then ends with two distinct machine-readable answer schemas, one for expert sessions and one for persona sessions;
- one self-contained accessible human survey HTML document.

Never substitute URL path depth for evidence relevance or replace an iFind row with a generated claim. Evidence-page class is not a user preference: choose a substantive named-product row with its exact HTTPS URL when one exists. A valid empty or irrelevant query result remains visible. A revised query must serve a declared unmet evidence need and must not repeat the same request. If the declared iFind source still does not verify the fact, record `数据缺失 (N/A)` and continue the source-defined four-deliverable algorithm without omitting the feature or artifact.

## Expert contract

The Task-scoped expert survey session loads the Denis and Oleg source-backed perspective Skills separately and processes them in canonical order. For each perspective it uses only the exact materialized directory returned by that Skill load to read `references/research/**`; the loaded directory is a frozen snapshot of the active package closure. Do not scan the source project, search for another copy, mix resources between perspectives, or read resources outside the current materialized location. Treat positioned citations as source research anchors while preserving both Skills' evidence-quality and authorship boundaries; never present the analysis as either named expert's direct opinion.

The expert vote is qualitative only. It has exactly these JSON fields: `name`, `type`, `persona_source`, `usage_freq`, `picks`, `reason`. `type` is `agent`. `persona_source` is the assigned visible perspective Skill name copied byte-for-value: exactly `denis-globa-perspective` or `oleg-mukhanov-perspective`, never a description, suffix, manifest ref, or generic label; the corresponding `name` is exactly `Denis Globa` or `Oleg Mukhanov`. `usage_freq` is exactly one of `daily`, `weekly`, `monthly`, or `rarely`; `picks` is three unique canonical codes. `reason` carries the full framework, ordered ten-row screen, three selected evidence chains with positioned package references, seven ordered rejected-feature reasons, confidence calibration, and honest boundary. Its eight structural headings are exact standalone lines in this order: `## 详细推理过程`, `### 评估框架`, `### 10 个功能逐项过筛`, `### Pick 1`, `### Pick 2`, `### Pick 3`, `### 为什么不选另外 7 个`, `### 诚实边界总声明`. Do not decorate, suffix, rename, omit, or duplicate one. In every Pick section of the JSON `reason` itself, the evidence chain cites at least one exact `<01-writings.md|02-conversations.md|03-expression-dna.md|04-external-views.md|05-decisions.md|06-timeline.md>#<N>` reference, where `N` is an integer from 1 through 10; labels such as `#关键发现`, `#决策4`, `#regulated fintech`, `#6.4`, and `#五-FULL` are invalid, and the three Pick sections collectively cite at least three distinct valid positioned item references. Inside the JSON `reason` string, `### 10 个功能逐项过筛` must be followed by a Markdown table whose first column contains exactly one ordered row for every code F01-F10; prose that only mentions all ten codes is invalid. The exact `### 诚实边界总声明` section contains the literal phrase `LLM 通用推断` and the exact standalone sentence `这不是 <exact assigned name> 本人直接陈述。`, with the placeholder replaced by `Denis Globa` or `Oleg Mukhanov`; wording that omits `本人` is invalid. It never contributes to quantitative persona scores.

After each perspective's three owned files are reread, snapshot them with their exact media types and call `mirror-watch/shared/publish-expert-survey` with the immutable Markdown, HTML, and data-module refs plus the exact selected upstream locators. This package tool validates the producer output and is the sole publisher of `mirror-watch/expert-survey` schema version 1. Generic `artifact_publish` must not publish this domain type. A rejection means the Task-scoped expert producer remains incomplete and the named owned-file violations must be repaired before another typed publication attempt.

The canonical agent survey is the full survey input, not a schema-only summary. Before its schema sections it contains exactly ten ordered headings `## F01. <exact title>` through `## F10. <exact title>`, and every heading carries the exact feature-local fields inherited from the recommendation. It then ends with `## 专家答卷契约` followed by exactly one fenced JSON expert example, then `## 画像答卷契约` followed by exactly one fenced JSON persona example. These are two contracts for two different respondent identities, not optional fields in one ambiguous schema. The persona example is grounded in the first exact identity of the persisted Task-selected cohort joined to its full authority row: copy that row's `name`, `uid`, `tier`, `status`, `interaction_mode`, and `top_dimension` without normalization; derive `usage_freq` from its raw behavior fields with the policy below; set both `user` and `name` to its exact `name`; set `type` to `persona`; and add only three distinct valid F-code picks plus a nonempty reason. Placeholder identity or segmentation values are invalid.

Each expert HTML uses one project-local JavaScript module assigning `window.<camelName>SurveyData`. Its only data shape is the source template contract: `persona`, `survey`, `reasonSummary`, `framework`, `picks`, `screening`, `notPicked`, and `honestBoundary`. `framework.lenses` has at least three `{ title, desc }` entries; `framework.heuristics` has at least five `{ n, text }` entries; the three ordered pick objects contain `rank`, `id`, `title`, recommendation-derived `timing`, `what`, `diff`, a Pick-section `verdict`, and distinct `{ title, chain, inference, confidence }` points; `screening` preserves the Markdown headers and all ten ordered rows as `{ id, name, cells, selected }`; `notPicked` preserves seven canonical-order `{ id, name, reason }` objects; and `honestBoundary` preserves at least three declarations. Every displayed value is copied verbatim from its canonical Markdown section rather than independently summarized.

## Persona contract

The current authoritative persona file is the package-owned 105-object JSON array, published whole regardless of the Task-selected cohort size. Every object explicitly contains `name`, `uid`, `tier`, `status`, `interaction_mode`, `top_dimension`, `daily_questions`, `recent_31d`, and `inactive_days`; preserve all other source fields unchanged. `usage_freq` is deliberately not an authority field. Derive it exactly as the source workflow does: `rarely` when `recent_31d` is zero and `inactive_days` is greater than 30; otherwise `daily` when `daily_questions >= 3`, `weekly` when `daily_questions >= 1`, and `monthly` otherwise.

Planning binds one exact nonempty ordered Task-selected cohort to that full authority. Exact named identities are preserved; a count-only request `N` selects the first `N` immutable authority rows and persists their exact names and UIDs. Eight is a valid request value, not a product default. Each planned persona owns exactly one JSON vote with exactly these fields: `user`, `name`, `uid`, `type`, `tier`, `status`, `interaction_mode`, `top_dimension`, `usage_freq`, `picks`, `reason`. Identity and segmentation values equal the matching authority object exactly. `type` is `persona`. `picks` contains three distinct codes from F01-F10, in preference order. `reason` is nonempty. There is exactly one vote for every planned identity and no duplicate, unplanned, or out-of-authority vote.

## Aggregation contract

Only `mirror-watch/shared/aggregate-report` may aggregate or render the final report. Its arguments are:

- `source_artifact_locators`: the unique exact selected Catalog locators for the report Delivery Slice revision, `mirror-watch/persona-authority`, typed `mirror-watch/research-delivery`, both typed `mirror-watch/expert-survey` Artifacts, and typed `mirror-watch/persona-survey-cohort`;
- `report_path`: final project-relative HTML path.

For each persona vote, first/second/third picks receive 3/2/1 points. Overall score, rank counts, mentions, tier/status/interaction-mode/usage-frequency matrices, pair bundles, and representative reasons come only from persona votes. Stable feature-code and persona-ID tie breaks make the output invariant to input path order. The total weighted score must equal the explicit cohort size multiplied by six.

The research lead and persona surveyor publish through `mirror-watch/shared/publish-research-delivery` and `mirror-watch/shared/publish-persona-cohort`; generic `artifact_publish` is not valid for these consumed domain types. The aggregate tool exactly rereads and selects every declared source before aggregation, consumes canonical features and all votes from those immutable typed payloads, and never rereads mutable survey, persona-vote, or expert-Markdown paths. The selected persona cohort may be smaller than the full authority. The tool rejects missing, duplicate, unreadable, or unselected source locators; duplicate identities; an unplanned or out-of-authority identity; invalid structured payloads; unknown or repeated feature codes; changed authority fields; unknown categories; missing, malformed, wrong-version, or wrong-producer typed Artifacts; and report paths outside the active project. An exact retry byte-verifies the existing report and reuses the one canonical exact-input publication; changed bytes or changed source identities fail loudly. It does not skip, normalize, truncate, infer, enlarge, or render partial planned data.

## Claim boundary

Report the actual Task-selected cohort size. The current package authority contains exactly 105 personas, but a valid subset is a completed delivery for its declared Task scope; it must not be described as all 105 or as a larger production cohort. Scale, external perspective-source parity, and production representativeness still require their own execution evidence.
