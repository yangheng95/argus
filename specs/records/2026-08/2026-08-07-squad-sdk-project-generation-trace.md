# Generate Agent Squads project generation trace

## Recall

| Item | Record |
| --- | --- |
| User request | Give the `Generate Agent Squads` system Expert Squad a special marker expressed through the existing OpenCorvus design language; make every Squad produced by that Expert Squad traceable; and save generated packages beneath the current project's `.opencorvus` directory. |
| Acceptance criteria | The Composer catalog distinguishes the generator with existing icon and badge primitives rather than a one-off visual language; SDK authoring and heterogeneous import both install into `.opencorvus/expert-squads/<namespace>/<id>/`; each successful generated installation contains canonical generation metadata and exposes that metadata through the Registry-owned catalog; generated packages remain inactive until explicitly selected; focused positive non-UI contracts, generated SDK contracts, typecheck, documentation health, and real-page screenshot review pass. |
| Hard constraints | This request explicitly replaces the 2026-08-06 user-global generation outcome; `prompt_profile.active` remains the only active Squad source; project installation uses the existing Manager transaction and Registry precedence; no compatibility alias, fallback, second catalog, UI-only identity guess, workflow engine, hidden message, UI automation test, or hand-built replacement design system is allowed. Preserve unrelated shared-worktree changes. |
| Sources read | `AGENTS.md`; `specs/current/architecture/04-extensions.md`; `specs/records/2026-08/2026-08-06-squad-sdk-expert-squad.md`; `tool/expert-squad-author.ts`; `expert-squad/conversation-authoring.ts`; `expert-squad/manager.ts`; `expert-squad/registry.ts`; `expert-squad/multica-import.ts`; `orchestrator/multica-import-tools.ts`; `expert-squad/catalog*.ts`; Composer reference selector, Expert Squad Settings panel, Badge/Icon/Listbox primitives, and current composer styles. |
| Whole-repository search | Authoring and Multica import currently hard-code `global`; the Manager already provides the required atomic project installation root; `.opencorvus-meta.json` is already a reserved package-internal runtime metadata filename excluded from package bytes/digest but has no reader or schema; catalog source currently distinguishes built-in/project/global but carries no generation provenance; the Composer receives the canonical catalog and currently renders every Squad with the same icon. |
| Independent agent feedback | None. The user did not request sub-agents or parallel audit, so no delegation was started. |

## Design

`squad-sdk` remains the sole built-in logical identity and declares the semantic system role `expert_squad_generator` in manifest v1. Registry projects that role through the canonical catalog. The Composer and Settings surfaces consume the field and use the existing `PackagePlus` icon plus canonical accent Badge; they do not compare display text or invent a second identity list.

Both `expert_squad_author` and `multica_import` pass the current Task and scheduler Session identity into one shared project-generation provenance writer. The Manager writes `.opencorvus-meta.json` into its validated staging tree before the existing atomic rename, with schema version, generator Squad ID, Task ID, Session ID, generation timestamp, method, and source-specific immutable digests. Source directories and ZIP packages cannot provide this Host-owned file. Package digest remains the digest of the portable validated package bytes; installation metadata remains machine/project execution provenance and is not exported as portable package content. The obsolete write-capable `/multica/import` route is removed so heterogeneous import has one Task/Session-owned path through `Generate Agent Squads`; read-only catalog and preview routes remain available.

Registry is the only metadata reader. Installed project catalog entries expose typed generation provenance from `.opencorvus-meta.json`; absence means an ordinary imported package, while malformed present metadata is a discovery error rather than an untracked fallback. Settings displays the provenance in package details. Generated packages are immediately discoverable in the current project's effective catalog and remain inactive until normal selection updates `prompt_profile.active`.

## Verification

- Positive SDK authoring contract: generated package is installed under the current project `.opencorvus/expert-squads`, contains exact typed trace metadata, and appears in that project catalog with the same trace.
- Positive Multica contract: import forwards project scope and exact Task/Session/source/mapping provenance into the shared metadata writer.
- Positive Registry/catalog contract: built-in `squad-sdk` exposes `expert_squad_generator`; a generated project installation exposes canonical generation provenance.
- Regenerate OpenAPI and JavaScript Software Development Kit (SDK) types, then run focused tests, typecheck, route checks, documentation checks, and historical-document links.
- Start the real Overlay, open the Composer reference selector and Settings package details, capture the current desktop surface, and personally review the special marker and trace presentation without creating or running UI automation tests.
