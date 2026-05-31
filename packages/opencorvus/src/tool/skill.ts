import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { PermissionNext } from "../permission/next"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"
import { isMirrorToolId } from "@/mirror/tools/ids"

export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all()
  const platform = process.platform

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        if (rule.action === "deny") return false
        if (
          agent.name !== "frontend-design" &&
          (skill.required_tools ?? []).some((toolID) => isMirrorToolId(toolID))
        ) {
          return false
        }
        return true
      })
    : skills

  const compatible = accessibleSkills.filter(
    (skill) => skill.platforms.length === 0 || skill.platforms.includes(platform as "win32" | "darwin" | "linux"),
  )
  const incompatible = accessibleSkills.filter(
    (skill) => skill.platforms.length > 0 && !skill.platforms.includes(platform as "win32" | "darwin" | "linux"),
  )

  const description =
    accessibleSkills.length === 0
      ? "Search for or load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
      : [
          "Search for or load a specialized skill that provides domain-specific instructions and workflows.",
          `Current platform: ${platform}`,
          "Call without a name to search/list skill metadata. Call with an exact name to load the full skill instructions.",
          "",
          "Use search before planning when the task may match a specialized workflow.",
          "",
          "Search output returns names, descriptions, required tool hints, and locations only. Loading by name returns a `<skill_content name=\"...\">` block with the full SKILL.md body and sampled bundled files.",
          incompatible.length > 0
            ? `${incompatible.length} skill(s) are incompatible with the current platform and will not appear in search results.`
            : "",
        ].join("\n")

  const parameters = z.object({
    query: z
      .string()
      .optional()
      .describe("Search terms for skill name, description, or required_tools. Omit to list compatible skills."),
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
          },
        }
      }

      const skill = accessibleSkills.find((item) => item.name === params.name)

      if (!skill) {
        const available = compatible.map((x) => x.name).join(", ")
        throw new Error(`Skill "${params.name}" not found or not allowed. Compatible skills: ${available || "none"}`)
      }

      if (skill.platforms.length > 0 && !skill.platforms.includes(platform as "win32" | "darwin" | "linux")) {
        const names = compatible.map((x) => x.name).join(", ")
        throw new Error(
          `Skill "${skill.name}" is not compatible with current platform (${platform}). Compatible skills: ${names || "none"}`,
        )
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
        },
      }
    },
  }
})

function searchSkills(skills: Skill.Info[], query: string | undefined): Skill.Info[] {
  const needle = query?.trim().toLocaleLowerCase()
  if (!needle) return skills
  return skills.filter((skill) => {
    const haystack = [
      skill.name,
      skill.description,
      ...(skill.required_tools ?? []),
    ].join("\n").toLocaleLowerCase()
    return haystack.includes(needle)
  })
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
    `    <description>${skill.description}</description>`,
    `    <required_tools>${(skill.required_tools ?? []).join(",") || "none"}</required_tools>`,
    `    <platforms>${skill.platforms.length ? skill.platforms.join(",") : "all"}</platforms>`,
    `    <location>${pathToFileURL(skill.location).href}</location>`,
    "  </skill>",
  ])
  return [...header, ...rows, "</skills>", "</skill_search>"].join("\n")
}
