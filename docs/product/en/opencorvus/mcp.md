# MCP (Model Context Protocol)

MCP is an open protocol led by Anthropic that defines a standard interface between LLM applications and external tool servers. Spec: [modelcontextprotocol.io](https://modelcontextprotocol.io).

OpenCorvus plays two roles:
1. **MCP Client** — connects to external MCP Servers, exposing their tools/prompts/resources to internal agents.
2. **MCP Server** — `opencorvus mcp serve` exposes its own tools to external agents (Claude Desktop, Codex, …).

Source: `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/mcp/serve.ts`

## Consuming external MCP Servers

At startup, OpenCorvus reads every `mcp` config entry and connects (`src/mcp/index.ts:164-211`):
- `"local"` → `StdioClientTransport` (subprocess stdin/stdout)
- `"remote"` → tries `StreamableHTTPClientTransport` first, falls back to `SSEClientTransport`

After connecting, `client.listTools()` runs; tool names are sanitized and registered as `{clientName}_{toolName}` on the agent's tool set.

## Configuration

**Local (stdio):**
```jsonc
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["node", "/path/to/server/index.js"],
      "environment": { "API_KEY": "sk-..." },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```
Source: `src/config/config.ts:533-552`.

**Remote (HTTP):**
```jsonc
{
  "mcp": {
    "my-remote": {
      "type": "remote",
      "url": "https://mcp.example.com/api",
      "headers": { "Authorization": "Bearer sk-..." },
      "oauth": false,
      "timeout": 15000
    }
  }
}
```
OAuth: `oauth: false` disables auto-detection; `oauth: { clientId, clientSecret, scope }` uses a pre-registered client. Source: `src/config/config.ts:569-591`.

## Capabilities

| Capability | Status |
|---|---|
| Tools (`listTools` + `callTool`) | Full |
| Prompts / Resources | Full |
| `ToolListChanged` notifications | Supported |
| StreamableHTTP / SSE / stdio | All supported |
| OAuth 2.0 + PKCE | Supported (remote, on by default) |
| Dynamic client registration (RFC 7591) | Supported |

## OAuth flow

When a remote server returns `UnauthorizedError`, it's marked `needs_auth`. Run:

```bash
opencorvus mcp auth <server-name>
```

OpenCorvus starts a local callback server, opens the authorization URL, exchanges code for tokens, and persists them to `~/.local/share/opencorvus/mcp-auth.json`.

Status: `opencorvus mcp status`. Remove: `opencorvus mcp remove-auth <server-name>`.

## Examples

**Local Filesystem:**
```jsonc
{ "mcp": { "fs": { "type": "local", "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user"] } } }
```

**Remote GitHub (Bearer Token):**
```jsonc
{ "mcp": { "github": { "type": "remote", "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer ghp_xxx" }, "oauth": false } } }
```

**Disable a configured server:**
```jsonc
{ "mcp": { "github": { "type": "remote", "url": "...", "enabled": false } } }
```

## OpenCorvus as MCP Server

```bash
opencorvus mcp serve --cwd /path/to/project --toolset executor
```

Exposes (`src/mcp/serve.ts:38-92`): `shell_command`, `read_file`, `find_files`, `search_code`, `apply_patch`, `fetch_url`, `web_search`, `memory`, `task_report` — plus every tool from locally connected MCP clients as a proxy tool (`src/mcp/serve.ts:129-131`).

## Connection status

| Status | Meaning |
|---|---|
| `connected` | Connected |
| `disabled` | `enabled: false` or manually disconnected |
| `failed` | Connection failed (see `error` field) |
| `needs_auth` | OAuth required |
| `needs_client_registration` | Server requires a pre-registered `clientId` |

Default timeout: 30 000 ms (`src/mcp/index.ts:31`); override via per-server `timeout` or global `experimental.mcp_timeout`.
