import { expect, test, describe } from "bun:test"
import { ConfigMarkdown } from "../../src/config/markdown"

describe("ConfigMarkdown: normal template", () => {
  const template = `This is a @valid/path/to/a/file and it should also match at
  the beginning of a line:

  @another-valid/path/to/a/file

  but this is not:

     - Adds a "Co-authored-by:" footer which clarifies which AI agent
       helped create this commit, using an appropriate \`noreply@...\`
       or \`noreply@anthropic.com\` email address.

  We also need to deal with files followed by @commas, ones
  with @file-extensions.md, even @multiple.extensions.bak,
  hidden directories like @.config/ or files like @.bashrc
  and ones at the end of a sentence like @foo.md.

  Also shouldn't forget @/absolute/paths.txt with and @/without/extensions,
  as well as @~/home-files and @~/paths/under/home.txt.

  If the reference is \`@quoted/in/backticks\` then it shouldn't match at all.`

  const matches = ConfigMarkdown.files(template)

  test("should extract exactly 12 file references", () => {
    expect(matches.length).toBe(12)
  })

  test("should extract valid/path/to/a/file", () => {
    expect(matches[0][1]).toBe("valid/path/to/a/file")
  })

  test("should extract another-valid/path/to/a/file", () => {
    expect(matches[1][1]).toBe("another-valid/path/to/a/file")
  })

  test("should extract paths ignoring comma after", () => {
    expect(matches[2][1]).toBe("commas")
  })

  test("should extract a path with a file extension and comma after", () => {
    expect(matches[3][1]).toBe("file-extensions.md")
  })

  test("should extract a path with multiple dots and comma after", () => {
    expect(matches[4][1]).toBe("multiple.extensions.bak")
  })

  test("should extract hidden directory", () => {
    expect(matches[5][1]).toBe(".config/")
  })

  test("should extract hidden file", () => {
    expect(matches[6][1]).toBe(".bashrc")
  })

  test("should extract a file ignoring period at end of sentence", () => {
    expect(matches[7][1]).toBe("foo.md")
  })

  test("should extract an absolute path with an extension", () => {
    expect(matches[8][1]).toBe("/absolute/paths.txt")
  })

  test("should extract an absolute path without an extension", () => {
    expect(matches[9][1]).toBe("/without/extensions")
  })

  test("should extract an absolute path in home directory", () => {
    expect(matches[10][1]).toBe("~/home-files")
  })

  test("should extract an absolute path under home directory", () => {
    expect(matches[11][1]).toBe("~/paths/under/home.txt")
  })

  test("should not match when preceded by backtick", () => {
    const backtickTest = "This `@should/not/match` should be ignored"
    const backtickMatches = ConfigMarkdown.files(backtickTest)
    expect(backtickMatches.length).toBe(0)
  })

  test("should not match email addresses", () => {
    const emailTest = "Contact user@example.com for help"
    const emailMatches = ConfigMarkdown.files(emailTest)
    expect(emailMatches.length).toBe(0)
  })

  test("should ignore at references inside markdown code", () => {
    const codeTest = [
      "Load @rules.md before editing.",
      "",
      "```ts",
      "import { createBridge } from '@ainvest/vibe-bridge';",
      "```",
      "",
      "Inline code like `/** @internal */` and `@quoted/path.md` is not a file include.",
      "Load @after.md too.",
    ].join("\n")
    const codeMatches = ConfigMarkdown.files(codeTest)
    expect(codeMatches.map((match) => match[1])).toEqual(["rules.md", "after.md"])
  })
})

describe("ConfigMarkdown: frontmatter parsing w/ empty frontmatter", async () => {
  const result = await ConfigMarkdown.parse(import.meta.dir + "/fixtures/empty-frontmatter.md")

  test("should parse without throwing", () => {
    expect(result).toBeDefined()
    expect(result.data).toEqual({})
    expect(result.content.trim()).toBe("Content")
  })
})

describe("ConfigMarkdown: frontmatter parsing w/ no frontmatter", async () => {
  const result = await ConfigMarkdown.parse(import.meta.dir + "/fixtures/no-frontmatter.md")

  test("should parse without throwing", () => {
    expect(result).toBeDefined()
    expect(result.data).toEqual({})
    expect(result.content.trim()).toBe("Content")
  })
})

describe("ConfigMarkdown: frontmatter parsing w/ Markdown header", async () => {
  const result = await ConfigMarkdown.parse(import.meta.dir + "/fixtures/markdown-header.md")

  test("should parse and match", () => {
    expect(result).toBeDefined()
    expect(result.data).toEqual({})
    expect(result.content.trim().replace(/\r\n/g, "\n")).toBe(`# Response Formatting Requirements

Always structure your responses using clear markdown formatting:

- By default don't put information into tables for questions (but do put information into tables when creating or updating files)
- Use headings (##, ###) to organise sections, always
- Use bullet points or numbered lists for multiple items
- Use code blocks with language tags for any code
- Use **bold** for key terms and emphasis
- Use tables when comparing options or listing structured data
- Break long responses into logical sections with headings`)
  })
})

describe("ConfigMarkdown: frontmatter has weird model id", async () => {
  const result = await ConfigMarkdown.parse(import.meta.dir + "/fixtures/weird-model-id.md")

  test("should parse and match", () => {
    expect(result).toBeDefined()
    expect(result.data["description"]).toEqual("General coding and planning agent")
    expect(result.data["mode"]).toEqual("subagent")
    expect(result.data["model"]).toEqual("synthetic/hf:zai-org/GLM-4.7")
    expect(result.data["tools"]["write"]).toBeTrue()
    expect(result.data["tools"]["read"]).toBeTrue()
    expect(result.data["stuff"]).toBe("This is some stuff\n")

    expect(result.content.trim()).toBe("Strictly follow da rules")
  })
})
