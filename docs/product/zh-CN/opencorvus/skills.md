# Skills（技能）

Skills 是 OpenCorvus 最轻量的扩展单元——一段带 YAML frontmatter 的 Markdown 文件，描述"在什么阶段、满足什么条件时，agent 应遵循哪些操作规则"。无需 TypeScript、无需编译，放进目录或从 URL 拉取即可。

源码：`packages/opencorvus/src/skill/skill.ts`、`packages/opencorvus/src/skill/manager.ts`

## 1. Skill 结构

```
my-skill/
├── SKILL.md        # 必需，frontmatter + 指令正文
├── agents/         # 可选：YAML 子 agent 定义
└── references/     # 可选：参考资料
```

Frontmatter 字段（`src/skill/skill.ts:26-45`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string（必需） | 全局唯一 ID，被 permission 引用 |
| `description` | string（必需） | 一句话描述，告诉 agent 何时激活 |
| `platforms` | `("win32"\|"darwin"\|"linux")[]` | 平台过滤，空数组 = 全平台 |
| `stage` | string | 流水线阶段：`spec` / `delivery` / ... |
| `auto_detect.files` | string[] | 项目中存在这些文件时自动加载 |
| `auto_detect.deps` | string[] | `package.json` 中存在这些依赖时自动加载 |
| `priority` | number | 多 skill 命中时的排序（大在前，默认 0） |

## 2. 内置 Skills

随二进制打包（`src/skill/skill.ts:74-81`）：

| Skill | 阶段 | 说明 |
|---|---|---|
| `panel-control` | 通用 | 通过 `panel` 工具操控 OpenCorvus 控制平面 |
| `spec-research` | spec | web 搜索研究技术选型，priority=10 |
| `prd-spec` | spec | 完整 PRD+SPEC 文档（含 ADR），priority=50 |
| `delivery-verify-web` | delivery | 前端验收清单（MIME、SPA、SSE），auto-detect |
| `delivery-verify-api` | delivery | 后端 API 验收清单，auto-detect |
| `opencorvus-channel-config-wizard` | 通用 | 14 个 channel 统一配置向导 |
| `opencorvus-<channel>-channel-config` | 通用 | 单 channel 配置引导（Slack / Telegram / Feishu / ...） |

内置 Skill 默认权限为 `allow`（`src/skill/manager.ts:493-495`）。

## 3. 添加本地 Skill

**方式 A**：放到项目 `.opencorvus/skill/<name>/SKILL.md` 或全局 config 目录下，启动时自动扫描。

**方式 B**：兼容 Claude Code 布局，`.claude/skills/` 或 `.agents/skills/` 也会被发现（`src/skill/skill.ts:68-69`）。

**方式 C**：在 `opencorvus.jsonc` 中声明搜索路径：

```jsonc
{
  "skills": {
    "paths": [
      "./my-skills",
      "~/shared/skills",
      "/absolute/path/skills"
    ]
  }
}
```

路径下所有 `**/SKILL.md` 都会被加载（`src/skill/skill.ts:200-217`）。

## 4. 从远程 URL 加载

```jsonc
{
  "skills": {
    "urls": ["https://skills.example.com/my-pack/"]
  }
}
```

加载流程（`src/skill/discovery.ts:39-97`）：

1. `GET {url}/index.json` 期望格式 `{ skills: [{ name, description, files[] }] }`
2. 按 `files` 逐一下载到 `~/.cache/opencorvus/skills/<name>/`
3. 加载缓存下的 `SKILL.md`

⚠️ 文件缓存后不再重新下载；更新需手动清缓存或 `opencorvus skill remove --url <url>`。

内置 Skill Market 条目（`src/skill/manager.ts:107-165`）：

| ID | 来源 | 信任等级 |
|---|---|---|
| `openai-skills` | github.com/openai/skills | official |
| `anthropic-skills` | github.com/anthropics/skills | official |
| `skills-sh` | skills.sh | curated |
| `skillstore` | skillstore.io | curated |
| `skills-pub` | skills.pub | community |

## 5. 通过 Git 安装

```bash
opencorvus skill install --git https://github.com/owner/repo.git
# 简写：opencorvus skill install owner/repo
```

Git 方式克隆到 `~/.config/opencorvus/skills-market/<slug>/` 并自动追加到 `skills.paths`；`.opencorvus-skill-source.json` 记录来源（`src/skill/manager.ts:285-302`）。

## 6. Skill ↔ Agent 调用关系

Skill 指令在 session 初始化时注入到 agent 的 system prompt。Agent 按 `description` 决定是否激活；`auto_detect` 提供文件/依赖自动匹配；`stage` 让流水线在对应阶段优先推送。

Skill 本身不能直接调用工具；它通过注入上下文影响 agent 行为。

## 7. Permission 配置

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

推荐策略：内置 `allow`；社区来源 `ask`；含 `scripts/` 目录的视为高风险（`src/skill/manager.ts:493-498`）。

## 8. 信任等级与风险

| 等级 | 来源 |
|---|---|
| `builtin` | 随二进制打包 |
| `official` | openai/skills 或 anthropics/skills |
| `curated` | skills.sh / skillstore.io |
| `community` | skills.pub |
| `local` | 本地路径 |
| `external` | `.claude/` 或 `.agents/` 目录发现 |

风险评估：目录含 `scripts/` → 高风险；含 `agents/` 或 `references/` → 中等（`src/skill/manager.ts:465-491`）。

## 9. 禁用外部 Skills

```bash
OPENCORVUS_DISABLE_EXTERNAL_SKILLS=1
# 或
OPENCORVUS_DISABLE_CLAUDE_CODE_SKILLS=1
```

跳过 `.claude/` 与 `.agents/` 目录扫描，不影响 `skills.paths` 与 `skills.urls`（`src/flag/flag.ts:134-139`）。
