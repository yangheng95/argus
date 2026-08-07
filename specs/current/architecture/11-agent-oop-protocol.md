# 11 - Agent Extension Protocol

> Current sources: `packages/opencorvus/src/agent/primary-assistant-registry.ts`,
> `helper-agent-registry.ts`, `host-agent-registry.ts`,
> `runtime-template-registry.ts`, `agent/runner.ts`, and
> `expert-squad/prompt-profile-resolver.ts`.

OpenCorvus does not expose a free-form native Agent class or an inheritance
registry. Identity is an explicit runtime contract owned by one of two
extension paths.

## Domain Worker Extension

A new domain worker is declared only under an external expert-squad package:

```text
.opencorvus/expert-squads/<namespace>/<squad-id>/
  expert-squad.jsonc
  agents/<agent-id>/...
```

The manifest key `capability_projection.agents.<agent-id>` is the exact package
runtime identity. It owns the label, optional prompt, `base_role`, and projected tools,
skills, and Model Context Protocol (MCP) providers. Dispatch, messages, runtime
contracts, catalog entries, and mounts retain this ID. `base_role` selects a
code-owned runtime template and never creates or aliases an identity.

The platform separately owns exact identity `universal-build`. It uses the
Build runtime template but is absent from package agents and workflow nodes.

Adding a domain worker therefore means updating the package manifest and its
owned resources, then testing registry preparation, resolver projection,
dispatch, runner, catalog, and mounts. It never means adding a native role or
editing a global prompt.

## Platform Identity Or Template Extension

A new platform-owned identity is exceptional. It must be added to exactly one
of `PrimaryAssistantRegistry`, `HelperAgentRegistry`, or `HostAgentRegistry`,
with a matching `AgentRoleContract` entry and Application Binary Interface
(ABI) tests for prompt, model, tool, permission, and lifecycle behavior.

A new reusable worker seed belongs in `RuntimeTemplateRegistry`. The template
defines code-owned session kind, dispatch adapter, and base prompt/tool seed.
It does not create a runnable worker until an active expert-squad projection
references it.

## Context And Runtime

`runAgentSession` receives a required dynamic agent ID, resolves its active
capability, derives the template once, and installs an immutable runtime
contract. Cross-agent evidence uses stable Artifact, Finding, and Attachment
references rendered by the
[`15-agent-facts-and-turns.md`](15-agent-facts-and-turns.md) prompt projection; packages do not
define a second workflow, mailbox, dispatch engine, or state machine.
