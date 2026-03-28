import { describe, test, expect } from "bun:test"
import {
  FILE_EXTS,
  FILE_PATH_PATTERN,
  extractWorkDir,
  extractFileRefs,
  resolveRefs,
  extractRequirements,
  extractEntities,
} from "../src/planner/patterns"

// ---------------------------------------------------------------------------
// FILE_EXTS constant
// ---------------------------------------------------------------------------

describe("FILE_EXTS", () => {
  test("is a pipe-separated string of common extensions", () => {
    expect(typeof FILE_EXTS).toBe("string")
    const exts = FILE_EXTS.split("|")
    expect(exts).toContain("ts")
    expect(exts).toContain("tsx")
    expect(exts).toContain("js")
    expect(exts).toContain("py")
    expect(exts).toContain("rs")
    expect(exts).toContain("go")
    expect(exts).toContain("json")
    expect(exts).toContain("yaml")
    expect(exts).toContain("yml")
    expect(exts).toContain("md")
    expect(exts).toContain("css")
    expect(exts).toContain("html")
    expect(exts).toContain("sql")
    expect(exts).toContain("sh")
    expect(exts).toContain("vue")
    expect(exts).toContain("svelte")
  })
})

// ---------------------------------------------------------------------------
// FILE_PATH_PATTERN regex
// ---------------------------------------------------------------------------

describe("FILE_PATH_PATTERN", () => {
  test("matches relative file paths with common extensions", () => {
    const text = "Please fix the bug in src/foo/bar.ts and update lib/utils.js"
    const matches = [...text.matchAll(FILE_PATH_PATTERN)]
    const paths = matches.map((m) => m[0])
    expect(paths).toContain("src/foo/bar.ts")
    expect(paths).toContain("lib/utils.js")
  })

  test("matches scoped package paths", () => {
    const text = "Check @scope/pkg/file.ts for the issue"
    const matches = [...text.matchAll(FILE_PATH_PATTERN)]
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches.some((m) => m[0].includes("file.ts"))).toBe(true)
  })

  test("does not match plain filenames without directory", () => {
    const text = "Look at index.ts"
    const matches = [...text.matchAll(FILE_PATH_PATTERN)]
    expect(matches.length).toBe(0)
  })

  test("matches multiple extensions", () => {
    const text = "a/b.py a/b.rs a/b.go a/b.java a/b.json a/b.yaml a/b.css a/b.html a/b.sql"
    const matches = [...text.matchAll(FILE_PATH_PATTERN)]
    expect(matches.length).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// extractWorkDir
// ---------------------------------------------------------------------------

describe("extractWorkDir", () => {
  test("extracts from '绝对路径: D:/foo/bar'", () => {
    expect(extractWorkDir("绝对路径: D:/foo/bar")).toBe("D:/foo/bar")
  })

  test("extracts from '绝对路径：C:\\Users\\test'", () => {
    expect(extractWorkDir("绝对路径：C:\\Users\\test")).toBe("C:\\Users\\test")
  })

  test("extracts from 'absolute path: D:/my-project'", () => {
    expect(extractWorkDir("absolute path: D:/my-project")).toBe("D:/my-project")
  })

  test("extracts from '工作目录: /home/user/project'", () => {
    expect(extractWorkDir("工作目录: /home/user/project")).toBe("/home/user/project")
  })

  test("extracts from 'working directory: D:/work/repo'", () => {
    expect(extractWorkDir("working directory: D:/work/repo")).toBe("D:/work/repo")
  })

  test("strips trailing slashes", () => {
    expect(extractWorkDir("绝对路径: D:/foo/bar/")).toBe("D:/foo/bar")
    expect(extractWorkDir("绝对路径: D:/foo/bar\\")).toBe("D:/foo/bar")
  })

  test("returns undefined when no work dir pattern found", () => {
    expect(extractWorkDir("just a plain request")).toBeUndefined()
    expect(extractWorkDir("")).toBeUndefined()
  })

  test("handles text with work dir embedded in longer content", () => {
    // The regex stops at whitespace or ) ） so Chinese commas are consumed
    const text = "请修改项目 绝对路径: D:/myhexin/argus-opencode 添加一个新功能"
    expect(extractWorkDir(text)).toBe("D:/myhexin/argus-opencode")
  })

  test("case insensitive for English patterns", () => {
    expect(extractWorkDir("Absolute Path: D:/myproject")).toBe("D:/myproject")
    expect(extractWorkDir("Working Directory: /opt/app")).toBe("/opt/app")
  })
})

// ---------------------------------------------------------------------------
// extractFileRefs
// ---------------------------------------------------------------------------

describe("extractFileRefs", () => {
  test("extracts @file: references", () => {
    const refs = extractFileRefs("Look at @file:src/router.ts for the issue")
    expect(refs.has("src/router.ts")).toBe(true)
  })

  test("extracts @ references without file: prefix", () => {
    const refs = extractFileRefs("Check @src/utils.ts")
    expect(refs.has("src/utils.ts")).toBe(true)
  })

  test("extracts backtick-wrapped paths", () => {
    const refs = extractFileRefs("The file `src/router.ts` has a bug")
    expect(refs.has("src/router.ts")).toBe(true)
  })

  test("extracts backtick paths without leading dot slash", () => {
    const refs = extractFileRefs("Edit `src/config.json`")
    expect(refs.has("src/config.json")).toBe(true)
  })

  test("extracts bare relative paths", () => {
    const refs = extractFileRefs("Modify src/planner/agent.ts to fix this")
    expect(refs.has("src/planner/agent.ts")).toBe(true)
  })

  test("extracts multiple refs of different types", () => {
    const text = "Check @file:src/a.ts and `src/b.js` and also src/c/d.py in the code"
    const refs = extractFileRefs(text)
    expect(refs.has("src/a.ts")).toBe(true)
    expect(refs.has("src/b.js")).toBe(true)
    expect(refs.has("src/c/d.py")).toBe(true)
  })

  test("returns empty set for text with no file refs", () => {
    const refs = extractFileRefs("just a plain request with no files")
    expect(refs.size).toBe(0)
  })

  test("deduplicates refs found by multiple patterns", () => {
    const text = "Fix `src/router.ts` and also look at src/router.ts"
    const refs = extractFileRefs(text)
    // Set ensures uniqueness, so even if both patterns match, only one entry
    expect(refs.has("src/router.ts")).toBe(true)
  })

  test("handles various file extensions", () => {
    const text = "`a/b.tsx` `a/b.jsx` `a/b.vue` `a/b.svelte` `a/b.yaml` `a/b.toml`"
    const refs = extractFileRefs(text)
    expect(refs.has("a/b.tsx")).toBe(true)
    expect(refs.has("a/b.jsx")).toBe(true)
    expect(refs.has("a/b.vue")).toBe(true)
    expect(refs.has("a/b.svelte")).toBe(true)
    expect(refs.has("a/b.yaml")).toBe(true)
    expect(refs.has("a/b.toml")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolveRefs
// ---------------------------------------------------------------------------

describe("resolveRefs", () => {
  test("returns empty array when refs set is empty", async () => {
    const result = await resolveRefs(new Set(), ["/base"], async () => "content")
    expect(result).toEqual([])
  })

  test("returns empty array when baseDirs is empty", async () => {
    const refs = new Set(["src/foo.ts"])
    const result = await resolveRefs(refs, [], async () => "content")
    expect(result).toEqual([])
  })

  test("resolves relative ref against first matching base dir", async () => {
    const refs = new Set(["src/foo.ts"])
    const baseDirs = ["/project1", "/project2"]
    const readFn = async (absPath: string) => {
      if (absPath.replace(/\\/g, "/").includes("/project1/src/foo.ts")) return "file content"
      return null
    }
    const result = await resolveRefs(refs, baseDirs, readFn)
    expect(result.length).toBe(1)
    expect(result[0].ref).toBe("src/foo.ts")
    expect(result[0].content).toBe("file content")
  })

  test("falls through to second base dir when first fails", async () => {
    const refs = new Set(["src/bar.ts"])
    const baseDirs = ["/project1", "/project2"]
    const readFn = async (absPath: string) => {
      if (absPath.replace(/\\/g, "/").includes("/project2/src/bar.ts")) return "found in project2"
      return null
    }
    const result = await resolveRefs(refs, baseDirs, readFn)
    expect(result.length).toBe(1)
    expect(result[0].ref).toBe("src/bar.ts")
    expect(result[0].content).toBe("found in project2")
  })

  test("skips unresolvable refs", async () => {
    const refs = new Set(["src/missing.ts", "src/found.ts"])
    const baseDirs = ["/project"]
    const readFn = async (absPath: string) => {
      if (absPath.replace(/\\/g, "/").includes("found.ts")) return "ok"
      return null
    }
    const result = await resolveRefs(refs, baseDirs, readFn)
    expect(result.length).toBe(1)
    expect(result[0].ref).toBe("src/found.ts")
  })

  test("handles absolute refs directly without base dirs", async () => {
    const refs = new Set(["/absolute/path/file.ts"])
    const baseDirs = ["/unused"]
    const readFn = async (absPath: string) => {
      if (absPath === "/absolute/path/file.ts") return "absolute content"
      return null
    }
    const result = await resolveRefs(refs, baseDirs, readFn)
    expect(result.length).toBe(1)
    expect(result[0].ref).toBe("/absolute/path/file.ts")
    expect(result[0].path).toBe("/absolute/path/file.ts")
    expect(result[0].content).toBe("absolute content")
  })

  test("returns nothing for absolute refs that fail to read", async () => {
    const refs = new Set(["/nonexistent/file.ts"])
    const baseDirs = ["/base"]
    const readFn = async () => null
    const result = await resolveRefs(refs, baseDirs, readFn)
    expect(result.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// extractRequirements
// ---------------------------------------------------------------------------

describe("extractRequirements", () => {
  test("extracts bullet list items (dash)", () => {
    const text = "Please do:\n- Add a login page\n- Fix the router bug"
    const reqs = extractRequirements(text)
    expect(reqs).toContain("Add a login page")
    expect(reqs).toContain("Fix the router bug")
  })

  test("extracts bullet list items (asterisk)", () => {
    const text = "* Implement caching\n* Optimize database queries"
    const reqs = extractRequirements(text)
    expect(reqs).toContain("Implement caching")
    expect(reqs).toContain("Optimize database queries")
  })

  test("extracts numbered list items", () => {
    const text = "1. Create the API endpoint\n2. Add validation\n3. Write tests"
    const reqs = extractRequirements(text)
    expect(reqs).toContain("Create the API endpoint")
    expect(reqs).toContain("Add validation")
    expect(reqs).toContain("Write tests")
  })

  test("extracts Chinese numbered list items with 、 and space", () => {
    // The pattern requires \s+ after the number separator
    const text = "1、 添加登录功能\n2、 修复路由问题"
    const reqs = extractRequirements(text)
    expect(reqs.length).toBe(2)
  })

  test("extracts Chinese action verb lines", () => {
    const text = "添加一个新的登录页面\n修改路由配置\n确保测试通过"
    const reqs = extractRequirements(text)
    expect(reqs.length).toBe(3)
    expect(reqs).toContain("添加一个新的登录页面")
    expect(reqs).toContain("修改路由配置")
    expect(reqs).toContain("确保测试通过")
  })

  test("extracts English action verb lines", () => {
    const text = "add a new endpoint\nfix the broken test\nrefactor the utils module"
    const reqs = extractRequirements(text)
    expect(reqs).toContain("add a new endpoint")
    expect(reqs).toContain("fix the broken test")
    expect(reqs).toContain("refactor the utils module")
  })

  test("skips short lines (< 4 chars)", () => {
    // trimmed.length < 4 means lines of 3 chars or fewer are skipped
    const text = "- x\n- this is valid"
    const reqs = extractRequirements(text)
    expect(reqs.length).toBe(1)
    expect(reqs[0]).toBe("this is valid")
  })

  test("skips blank lines", () => {
    const text = "\n\n- valid item\n\n"
    const reqs = extractRequirements(text)
    expect(reqs.length).toBe(1)
  })

  test("returns empty array for plain prose", () => {
    const text = "This is a paragraph of text that describes something without any structure."
    const reqs = extractRequirements(text)
    expect(reqs).toEqual([])
  })

  test("handles bullet list with dot marker", () => {
    const text = "• First item\n• Second item"
    const reqs = extractRequirements(text)
    expect(reqs.length).toBe(2)
  })

  test("handles additional Chinese action verbs", () => {
    const text = "创建一个新模块\n删除废弃代码\n优化性能\n重构登录流程\n导出接口定义\n配置环境变量"
    const reqs = extractRequirements(text)
    expect(reqs.length).toBe(6)
  })

  test("handles additional English action verbs", () => {
    const text = "create a service\ndelete unused files\nremove the old handler\nimplement the feature\nenable debug mode\nconfigure the database"
    const reqs = extractRequirements(text)
    expect(reqs.length).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

describe("extractEntities", () => {
  test("extracts backtick-wrapped names", () => {
    const text = "Look at the `Router` and `Middleware` types"
    const entities = extractEntities(text)
    expect(entities).toContain("Router")
    expect(entities).toContain("Middleware")
  })

  test("extracts class/type/interface/function keyword patterns", () => {
    const text = "The class UserService and type Config need changes"
    const entities = extractEntities(text)
    expect(entities).toContain("UserService")
    expect(entities).toContain("Config")
  })

  test("extracts interface and function keywords", () => {
    const text = "Check interface Handler and function processRequest"
    const entities = extractEntities(text)
    expect(entities).toContain("Handler")
    expect(entities).toContain("processRequest")
  })

  test("filters out common English stop words", () => {
    const text = "Check `the` and `is` and `to` values"
    const entities = extractEntities(text)
    expect(entities).not.toContain("the")
    expect(entities).not.toContain("is")
    expect(entities).not.toContain("to")
  })

  test("filters out single-character names", () => {
    const text = "Variable `x` is used"
    const entities = extractEntities(text)
    expect(entities).not.toContain("x")
  })

  test("extracts Chinese entity patterns", () => {
    const text = "Router 类型需要修改，Handler 类需要更新"
    const entities = extractEntities(text)
    expect(entities).toContain("Router")
    expect(entities).toContain("Handler")
  })

  test("extracts Chinese function/method/interface patterns", () => {
    const text = "processData 方法和 IService 接口"
    const entities = extractEntities(text)
    expect(entities).toContain("processData")
    expect(entities).toContain("IService")
  })

  test("deduplicates entities", () => {
    const text = "class Router and `Router` type"
    const entities = extractEntities(text)
    const routerCount = entities.filter((e) => e === "Router").length
    expect(routerCount).toBe(1)
  })

  test("returns empty array for text with no entities", () => {
    const text = "Just a plain description without any code references"
    const entities = extractEntities(text)
    expect(entities).toEqual([])
  })
})
