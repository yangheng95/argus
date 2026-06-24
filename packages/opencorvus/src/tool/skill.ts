import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import fuzzysort from "fuzzysort"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"
import type { SkillMount } from "@/skill/mounts"

export const SkillTool = Tool.define("skill", async (ctx) => {
  const { SkillMount } = await import("@/skill/mounts")
  const agent = ctx?.agent
  const surface = ctx?.skillSurface
    ? ctx.skillSurface
    : agent
      ? await SkillMount.resolve({ agent, config: ctx?.config })
      : ({
          agent: "unbound",
          scope: "project" as const,
          tool_available: false,
          unmounted_pool_count: 0,
          skills: [],
        } satisfies SkillMount.ResolvedAgentSkillSurface)
  const mounted = surface.skills
  const compatible = mounted.filter((skill) => skill.enabled).map((skill) => skill.skill)
  const disabled = mounted.filter((skill) => !skill.enabled)

  const description =
    compatible.length === 0
      ? "Search for or load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
      : [
          "Search for or load a specialized skill that provides domain-specific instructions and workflows.",
          `Current agent: ${surface.agent}`,
          "Call without a name to search/list skill metadata. Call with an exact name to load the full skill instructions.",
          "",
          "Use search before planning when the task may match a specialized workflow. Search is fuzzy across mounted skill titles and SKILL.md contents.",
          "",
          'Search output returns names, descriptions, required tool hints, and locations only. Loading by name returns a `<skill_content name="...">` block with the full SKILL.md body and sampled bundled files.',
          disabled.length > 0
            ? `${disabled.length} mounted skill(s) are disabled and will not appear in search results.`
            : "",
          surface.unmounted_pool_count > 0
            ? `${surface.unmounted_pool_count} pool skill(s) are unmounted and unavailable to this agent.`
            : "",
        ].join("\n")

  const parameters = z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Fuzzy search terms for mounted skill title, description, required_tools, agents, or SKILL.md content. Omit to list compatible skills.",
      ),
    name: z
      .string()
      .optional()
      .describe("Exact skill name to load. Omit name to search/list skills instead of loading full instructions."),
  })

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (!params.name) {
        const matches = searchSkills(compatible, params.query).slice(0, 20)
        const query = params.query?.trim()
        return {
          title: query ? `Skill search: ${query}` : "Skill list",
          output: renderSkillSearch(matches, compatible.length, query),
          metadata: {
            query: query ?? "",
            count: matches.length,
            total: compatible.length,
            names: matches.map((skill) => skill.name),
            name: "",
            dir: "",
            agent: surface.agent,
            scope: surface.scope,
          },
        }
      }

      const skill = compatible.find((item) => item.name === params.name)

      if (!skill) {
        const available = compatible.map((x) => x.name).join(", ")
        throw new Error(`Skill "${params.name}" not found or not allowed. Compatible skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      const dir = path.dirname(skill.location)
      const base = pathToFileURL(dir).href

      const limit = 10
      const files = await iife(async () => {
        const arr: string[] = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (file.includes("SKILL.md")) {
            continue
          }
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) {
            break
          }
        }
        return arr
      }).then((f) => f.map((file) => `<file>${file}</file>`).join("\n"))

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          "",
          skill.content.trim(),
          "",
          `Base directory for this skill: ${base}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
          "Note: file list is sampled.",
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          "</skill_content>",
        ].join("\n"),
        metadata: {
          query: "",
          count: 1,
          total: compatible.length,
          names: [skill.name],
          name: skill.name,
          dir,
          agent: surface.agent,
          scope: surface.scope,
        },
      }
    },
  }
})

function searchSkills(skills: Skill.Info[], query: string | undefined): Skill.Info[] {
  const needle = query?.trim()
  if (!needle) return skills
  const entries = skills.map((skill) => ({ skill, text: skillSearchText(skill) }))
  return fuzzysort.go(needle, entries, { key: "text", threshold: -10000 }).map((match) => match.obj.skill)
}

function skillSearchTitle(skill: Skill.Info): string {
  const heading = skill.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+\S/.test(line))
  return heading?.replace(/^#{1,6}\s+/, "").trim() || skill.name
}

function skillSearchText(skill: Skill.Info): string {
  return [
    skill.name,
    skillSearchTitle(skill),
    skill.description,
    ...(skill.required_tools ?? []),
    ...skill.agents,
    skill.content,
  ].join("\n")
}

function renderSkillSearch(skills: Skill.Info[], total: number, query: string | undefined): string {
  const header = [
    "<skill_search>",
    query ? `<query>${query}</query>` : "<query></query>",
    `<matched>${skills.length}</matched>`,
    `<total_compatible>${total}</total_compatible>`,
    "Use the exact <name> value with this tool to load full instructions.",
    "<skills>",
  ]
  const rows = skills.flatMap((skill) => [
    "  <skill>",
    `    <name>${skill.name}</name>`,
    `    <title>${skillSearchTitle(skill)}</title>`,
    `    <description>${skill.description}</description>`,
    `    <required_tools>${(skill.required_tools ?? []).join(",") || "none"}</required_tools>`,
    `    <agents>${skill.agents.join(",") || "all"}</agents>`,
    `    <platforms>${skill.platforms.length ? skill.platforms.join(",") : "all"}</platforms>`,
    `    <location>${pathToFileURL(skill.location).href}</location>`,
    "  </skill>",
  ])
  return [...header, ...rows, "</skills>", "</skill_search>"].join("\n")
}
