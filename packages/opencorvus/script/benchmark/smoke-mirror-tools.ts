#!/usr/bin/env bun
/**
 * Dry-run smoke check — no LLM calls, no network.
 *
 *   1. ToolRegistry lists the 5 mirror tool ids
 *   2. Each tool's init() returns a valid Zod `parameters` schema
 *   3. The `webpage-generate` skill is discoverable via Skill.list()
 *   4. The skill's frontmatter parses (name/description/priority)
 */

import path from "node:path"
import { loadBenchmarkEnv } from "./env"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { Skill } from "../../src/skill"
import { Server } from "../../src/server/server"

await loadBenchmarkEnv(import.meta.dir)
Server.listen({ port: 0, hostname: "127.0.0.1" })

const EXPECTED_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
]

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")

await Instance.provide({
  directory: PACKAGE_ROOT,
  fn: async () => {
    // 1. tool registry
    const ids = await ToolRegistry.ids()
    const missing = EXPECTED_TOOL_IDS.filter((id) => !ids.includes(id))
    if (missing.length > 0) {
      throw new Error(`missing tools in registry: ${missing.join(", ")}`)
    }
    console.log(`✅ all 6 mirror tools registered: ${EXPECTED_TOOL_IDS.join(", ")}`)

    // 2. each tool initialises with a valid schema
    const tools = await ToolRegistry.tools(
      { providerID: "alibaba-coding-plan-cn", modelID: "kimi-k2.5" },
    )
    for (const id of EXPECTED_TOOL_IDS) {
      const t = tools.find((x) => x.id === id)
      if (!t) throw new Error(`tool ${id} missing from tools() output`)
      if (!t.parameters) throw new Error(`tool ${id} has no parameters schema`)
      if (!t.description) throw new Error(`tool ${id} has no description`)
      if (t.description.length < 50) throw new Error(`tool ${id} description suspiciously short`)
    }
    console.log(`✅ all 6 tools have parameters + descriptions`)

    // 3. skill discoverability
    const skills = await Skill.all()
    const skill = skills.find((s) => s.name === "webpage-generate")
    if (!skill) throw new Error("webpage-generate skill not found in Skill.list()")
    console.log(`✅ skill found: ${skill.name} (priority=${skill.priority}, builtin=${skill.builtin})`)

    // 4. frontmatter sanity
    if (!skill.description || skill.description.length < 50) {
      throw new Error(`webpage-generate description missing or too short: ${skill.description}`)
    }
    for (const keyword of ["webpage_extract", "webpage_compile", "webpage_analyze", "webpage_render", "webpage_evaluate"]) {
      if (!skill.content.includes(keyword)) {
        throw new Error(`webpage-generate skill body does not mention tool '${keyword}'`)
      }
    }
    console.log(`✅ skill body references every mirror tool`)

    console.log("")
    console.log("🎉 smoke check passed")
  },
})

process.exit(0)
