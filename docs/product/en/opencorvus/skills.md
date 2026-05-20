# Skills

A Skill is OpenCorvus's lightest extension unit: a Markdown file with YAML frontmatter that tells agents _when_ and _how_ to behave for recurring task shapes. No TypeScript, no compilation — drop a `SKILL.md` into a directory or pull one from a URL.

Source: `packages/opencorvus/src/skill/skill.ts`, `packages/opencorvus/src/skill/manager.ts`

## Skill structure

```
my-skill/
├── SKILL.md          # required — frontmatter + instruction body
├── agents/           # optional — YAML sub-agent definitions
└── references/       # optional — reference documents
```

Frontmatter fields (`src/skill/skill.ts:26-45`):

| Field | Type | Description |
|---|---|---|
| `name` | string (required) | Global unique ID |
| `description` | string (required) | One-line description used by the agent to decide when to activate |
| `platforms` | `("win32"\|"darwin"\|"linux")[]` | Platform filter; empty = all |
| `stage` | string | Owning pipeline stage, for example `design_analyst` or `build` |
| `auto_detect.files` | string[] | Load when these files exist |
| `auto_detect.deps` | string[] | Load when `package.json` lists these deps |
| `auto_detect.task_signals` | object | Load from task signals such as image attachment, non-Figma URL, Figma URL, package scripts, or request text |
| `priority` | number | Sort order (higher first, default 0) |
| `required_tools` | string[] | Tool calls the owning stage must complete before reporting success |

## Skill ↔ agent relationship

When `auto_detect` matches the project or task signals, the session prompt receives the matched `SKILL.md` instruction body. Matching skills are visible across stages, so relevant guidance is not lost because a stage label differs.

`stage` means ownership for `required_tools`, not discovery visibility:

- A `stage: "build"` skill can be injected into other stages as context, but build owns its `required_tools`.
- A `stage: "design_analyst"` skill can be injected into build as context, but design-analysis owns mirror acquisition `required_tools`.
- A skill without `stage` is global, and its `required_tools` apply through the active agent invocation. If no active stage is provided, only global skills contribute `required_tools`.

Skills cannot directly call tools. They influence the agent through injected instructions plus stage-owned required-tool contracts.

## Built-in skills

Shipped with the binary (`src/skill/skill.ts`), exactly three:

| Name | Stage | Purpose |
|---|---|---|
| `webpage-generate` | design_analyst | Produce a mirror-grounded PRD/SPEC for a live webpage reference |
| `image-generate` | design_analyst | Produce a mirror-grounded PRD/SPEC from screenshot-only visual references |
| `research-report` | build | Produce a sourced Markdown research report using `websearch` and targeted `webfetch` |

Other skills must be loaded through configured skill paths or URLs if you need them.

Built-in skills get `allow` policy by default (`src/skill/manager.ts`).

## Adding a local skill

**A**: drop into `.opencorvus/skill/<name>/SKILL.md` (project or global).
**B**: Claude Code layout — `.claude/skills/` or `.agents/skills/` also discovered (`src/skill/skill.ts:68-69`).
**C**: declare paths in `opencorvus.jsonc`:

```jsonc
{ "skills": { "paths": ["./my-skills", "~/shared/skills"] } }
```

All `**/SKILL.md` under each path load (`src/skill/skill.ts:200-217`).

## Loading from a remote URL

```jsonc
{ "skills": { "urls": ["https://skills.example.com/my-pack/"] } }
```

OpenCorvus fetches `{url}/index.json` (`{ skills: [{ name, description, files[] }] }`), downloads each file, caches under `~/.cache/opencorvus/skills/`, loads `SKILL.md` (`src/skill/discovery.ts:39-97`).

Built-in marketplace entries (`src/skill/manager.ts:107-165`): `openai-skills`, `anthropic-skills` (official); `skills-sh`, `skillstore` (curated); `skills-pub` (community).

## Installing from Git

```bash
opencorvus skill install --git https://github.com/owner/repo.git
# shorthand: opencorvus skill install owner/repo
```

Clones into `~/.config/opencorvus/skills-market/<slug>/`, appends to `skills.paths`, writes `.opencorvus-skill-source.json` (`src/skill/manager.ts:285-302`).

## Permission config

```jsonc
{
  "permission": {
    "skill": {
      "*": "ask",
      "research-report": "allow",
      "local-note": "deny"
    }
  }
}
```

Built-in → `allow`; community/external → `ask`; skills with a `scripts/` directory → `ask` (high risk) (`src/skill/manager.ts:493-498`).

## Disabling external discovery

```bash
OPENCORVUS_DISABLE_EXTERNAL_SKILLS=1
```

Skips `.claude/` and `.agents/` discovery. Does not affect `skills.paths` or `skills.urls` (`src/flag/flag.ts:134-139`).
