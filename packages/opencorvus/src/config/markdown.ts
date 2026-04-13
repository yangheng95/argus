import { NamedError } from "@opencorvus-ai/util/error"
import matter from "gray-matter"
import { z } from "zod"
import { Filesystem } from "../util/filesystem"

export namespace ConfigMarkdown {
  export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
  export const SHELL_REGEX = /!`([^`]+)`/g

  export function files(template: string) {
    return Array.from(template.matchAll(FILE_REGEX))
  }

  export function shell(template: string) {
    return Array.from(template.matchAll(SHELL_REGEX))
  }

  export async function parse(filePath: string) {
    const template = await Filesystem.readText(filePath)
    try {
      return matter(template)
    } catch (err) {
      throw new FrontmatterError(
        {
          path: filePath,
          message: `${filePath}: Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        },
        { cause: err },
      )
    }
  }

  export const FrontmatterError = NamedError.create(
    "ConfigFrontmatterError",
    z.object({
      path: z.string(),
      message: z.string(),
    }),
  )
}
