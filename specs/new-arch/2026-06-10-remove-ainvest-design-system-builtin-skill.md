# Remove Ainvest Design System Builtin Skill

## Goal

Delete the bundled `ainvest-design-system` skill so OpenCorvus no longer ships, registers, documents, or tests that built-in skill. The skill can still be provided later as a normal external/local skill through `skills.paths` or `skills.urls`.

## Repository Inventory

Search command:

```bash
rg -n "ainvest-design-system|aivest-design-system|ainvestDesignSystem" packages docs specs script RELEASE.md -S
```

| Location | Decision |
| --- | --- |
| `packages/opencorvus/src/skill/skill.ts` import and `builtins` entry | Delete import and registration entry. |
| `packages/opencorvus/src/skill/builtin/ainvest-design-system.ts` | Delete generated bundled skill payload file. |
| `packages/opencorvus/test/skill/skill.test.ts` built-in registration test | Replace positive registration test with a removed-builtin assertion. |
| `packages/opencorvus/test/tool/skill.test.ts` build-agent load assertion | Replace positive load assertion with not-visible/search and not-loadable exact-name assertions. |
| `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` fixture skill payload | Remove mocked Aivest/Ainvest built-in row so the browser skill panel reflects the new built-in list. |
| `docs/product/en/opencorvus/skills.md` and `packages/web/src/content/docs/skills.mdx` | Update built-in list from two skills to one skill. |
| `docs/product/zh-CN/opencorvus/skills.md` and `packages/web/src/content/docs/zh-cn/skills.mdx` | Update built-in list from two skills to one skill and fix trust-count text. |

## Validation

Run the focused tests that cover skill registration, the skill tool, and the affected overlay browser fixture:

```bash
bun test --timeout 60000 packages/opencorvus/test/skill/skill.test.ts packages/opencorvus/test/tool/skill.test.ts
bun run --cwd packages/overlay test:browser -- side-activity-toolbar-browser.test.ts
```
