# Skills

A Skill is OpenCorvus's lightest extension unit: a Markdown file with YAML frontmatter that tells agents _when_ and _how_ to behave at a specific pipeline stage. No TypeScript, no compilation — drop a `SKILL.md` into a directory or pull one from a URL.

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
| `stage` | string | `spec`, `delivery`, … |
| `auto_detect.files` | string[] | Load when these files exist |
| `auto_detect.deps` | string[] | Load when `package.json` lists these deps |
| `priority` | number | Sort order (higher first, default 0) |

## Built-in skills

Shipped with the binary (`src/skill/skill.ts:74-81`):

| Name | Stage | Purpose |
|---|---|---|
| `panel-control` | general | Operate OpenCorvus via the `panel` tool |
| `spec-research` | spec | Web-search research for stack selection |
| `prd-spec` | spec | Full PRD + SPEC authoring with ADR |
| `delivery-verify-web` | delivery | Frontend acceptance (MIME, SPA, SSE) |
| `delivery-verify-api` | delivery | Backend API acceptance |
| `opencorvus-channel-config-wizard` | general | Unified setup wizard for 14 channels |
| `opencorvus-<channel>-channel-config` | general | Per-channel guided setup |

Built-in skills get `allow` policy by default (`src/skill/manager.ts:493-495`).

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
      "prd-spec": "allow",
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
