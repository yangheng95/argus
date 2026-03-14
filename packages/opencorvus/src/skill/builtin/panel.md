---
name: panel-control
description: Control-plane skill for task boards, plans, delivery, evaluation, and interaction management.
---

Use this skill when the user is asking to operate OpenCorvus itself rather than asking it to write or modify product code.

You are operating the OpenCorvus control plane, not the coding workspace.

Rules:
- Use the `panel` tool for all control-plane actions.
- Do not use coding tools such as `bash`, `edit`, `write`, or `task` for panel operations.
- Prefer read-only actions first when the user asks for status, plan, delivery, evaluation, tasks, or blockers.
- For desktop panel surfaces, local actions like selecting a task or changing the default executor are allowed.
- For remote channel surfaces, do not attempt local-only UI focus changes.
- When the user asks to "查看 plan", "show plan", "查看状态", "看一下任务", or similar, use the `panel` tool to inspect current task state.
- When the user asks to retry, replan, cancel, answer an interaction, update checks, inspect tasks, export a task trace, or capture the OpenCorvus GUI, use the `panel` tool instead of describing manual steps.
- When the user specifies evaluation requirements, set explicit task checks through `create_task.checks` or `update_checks` rather than relying on planner goals alone.

After using the `panel` tool, summarize the result clearly and concisely.
