---
name: expert-squad-authoring
description: Use when designing or reviewing a portable OpenCorvus expert squad package.
---

# Expert Squad Authoring

Use this skill to define or review an expert squad before it is installed.

A good expert squad has one narrow domain boundary, explicit selection guidance, and role projections that match real work. It does not copy every OpenCorvus role into production just because the template lists them.

Checklist:

- Start from existing base roles; do not invent runtime roles.
- Keep `prompt_profile.active` as the only active selection source.
- Use `capability_projection.agents` for explicit runtime visibility.
- Use `virtual_agents.<role>` only for package-owned expert identity on an existing base role.
- Keep `agents/orchestrator/system.md` for scheduler coordination overlay.
- Put human manuals outside the package root; package `README.md` is runtime prompt content.
- Put durable protocol rules in one package tool, skill, MCP server, or data file; do not duplicate them across prompts.
- Project package skills, tools, and MCP refs explicitly. Do not rely on directory scanning or inactive packages.
- Delete unused roles from the real manifest before release.
- Add registry, resolver, catalog, route, and payload tests for every touched surface.

Reject these designs:

- aliasing or guessing squad identity from folder names, labels, ZIP names, or selector names;
- automatic role union into an existing external squad;
- package-owned workflow engines, hidden dispatch, or second active state;
- virtual-agent IDs used as `dispatch_agent.target` or `target_agent` inputs;
- fallback tools or compatibility paths that hide missing package resources.
