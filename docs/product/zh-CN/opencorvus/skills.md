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

Frontmatter 字段（`src/skill/skill.ts:23-63`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string（必需） | 全局唯一 ID，被 permission 引用 |
| `description` | string（必需） | 一句话描述，告诉 agent 何时激活 |
| `platforms` | `("win32" \| "darwin" \| "linux")[]` | 平台过滤，空数组 = 全平台 |
| `auto_detect.files` | string[] | 项目中存在这些文件时作为发现提示 |
| `auto_detect.deps` | string[] | `package.json` 中存在这些依赖时作为发现提示 |
| `auto_detect.task_signals` | object | 任务级发现提示（`has_attachment_image` / `request_contains_url` / `request_contains_figma_url` / `package_has_script[]` / `request_text_any[]`） |
| `priority` | number | 多 skill 命中时的排序（大在前，默认 0） |
| `required_tools` | string[] | skill 预期可能需要的工具提示 |

## 2. 内置 Skills

随二进制打包（`src/skill/skill.ts` 的 `builtins` 数组），**只有两个**：

| Skill | 用途 |
|---|---|
| `ainvest-design-system` | 提供内置 Ainvest UI tokens、组件、规则和资产，用于 Ainvest 前端工作 |
| `research-report` | 用 `websearch` 和按需 `webfetch` 产出带来源的 Markdown 调研报告 |

> 其他 skill 需要通过 `skills.paths` / `skills.urls` 显式加载。
>
> `panel-control` builtin skill 已在 commit `f94f56231` 删除；`webpage-generate` builtin skill 也已删除。仍引用这些 skill 的客户端会找不到对应 skill。

内置 Skill 默认权限为 `allow`（`src/skill/manager.ts`）。

## 3. 添加本地 Skill

**方式 A**：放到项目 `.opencorvus/skill/<name>/SKILL.md` 或全局 config 目录下，启动时自动扫描。

**方式 B**：兼容 Claude Code 布局，`.claude/skills/` 或 `.agents/skills/` 也会被发现。

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

路径下所有 `**/SKILL.md` 都会被加载。

## 4. 从远程 URL 加载

```jsonc
{
  "skills": {
    "urls": ["https://skills.example.com/my-pack/"]
  }
}
```

加载流程（`src/skill/discovery.ts`）：

1. `GET {url}/index.json`，期望格式 `{ skills: [{ name, description, files[] }] }`
2. 按 `files` 逐一下载到 `~/.cache/opencorvus/skills/<name>/`
3. 加载缓存下的 `SKILL.md`

⚠️ 文件缓存后不再重新下载；更新需手动清缓存或 `opencorvus skill remove --url <url>`。

内置 Skill Market 条目（`src/skill/manager.ts`）：

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
# 简写：
opencorvus skill install owner/repo
```

克隆到 `~/.config/opencorvus/skills-market/<slug>/` 并自动追加到 `skills.paths`；`.opencorvus-skill-source.json` 记录来源。

## 6. Skill ↔ Agent 调用关系

Session 初始化时会提供 Skill Policy 与可用 skill 摘要。Agent 需要通过 `skill` 工具搜索或按精确名称加载 `SKILL.md`，然后执行其中的工作流。加载 skill 是会话历史中的可见工具调用。

`auto_detect` 仅作为发现 / 排序 / 后续 UI 辅助的元数据，不再把 skill 正文隐藏注入 system prompt，也不会自动打开工具。`required_tools` 是 skill 搜索结果中的描述性提示；真正的证据要求由加载后的 skill 文档说明。

## 7. Permission 配置

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

推荐策略：内置 `allow`；社区来源 `ask`；含 `scripts/` 目录的视为高风险。

## 8. 信任等级与风险

| 等级 | 来源 |
|---|---|
| `builtin` | 随二进制打包（3 个） |
| `official` | openai/skills 或 anthropics/skills |
| `curated` | skills.sh / skillstore.io |
| `community` | skills.pub |
| `local` | 本地路径 |
| `external` | `.claude/` 或 `.agents/` 目录发现 |

风险评估：目录含 `scripts/` → 高风险；含 `agents/` 或 `references/` → 中等。

## 9. 禁用外部 Skills

```bash
OPENCORVUS_DISABLE_EXTERNAL_SKILLS=1
# 或
OPENCORVUS_DISABLE_CLAUDE_CODE_SKILLS=1
```

跳过 `.claude/` 与 `.agents/` 目录扫描，不影响 `skills.paths` 与 `skills.urls`。
