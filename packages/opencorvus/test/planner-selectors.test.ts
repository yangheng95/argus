import { describe, test, expect } from "bun:test"
import { DEFAULT_SELECTORS, inferSelectors, inferGoalSelectors } from "../src/planner/selectors"

// ---------------------------------------------------------------------------
// DEFAULT_SELECTORS
// ---------------------------------------------------------------------------

describe("DEFAULT_SELECTORS", () => {
  test("contains exactly 4 default selectors", () => {
    expect(DEFAULT_SELECTORS.length).toBe(4)
  })

  test("includes build, test, lint, verify_cmd", () => {
    expect(DEFAULT_SELECTORS).toContain("build")
    expect(DEFAULT_SELECTORS).toContain("test")
    expect(DEFAULT_SELECTORS).toContain("lint")
    expect(DEFAULT_SELECTORS).toContain("verify_cmd")
  })

  test("is readonly", () => {
    // TypeScript enforces readonly at compile time, but we can verify the values are stable
    expect([...DEFAULT_SELECTORS]).toEqual(["build", "test", "lint", "verify_cmd"])
  })
})

// ---------------------------------------------------------------------------
// inferSelectors
// ---------------------------------------------------------------------------

describe("inferSelectors", () => {
  test("always includes the 4 default selectors for any request", () => {
    const result = inferSelectors("fix a bug in the code")
    expect(result).toContain("build")
    expect(result).toContain("test")
    expect(result).toContain("lint")
    expect(result).toContain("verify_cmd")
  })

  test("returns at least 4 selectors for empty request", () => {
    const result = inferSelectors("")
    expect(result.length).toBeGreaterThanOrEqual(4)
  })

  // UI/UX keywords
  test("adds ui_review for 'ui' keyword", () => {
    const result = inferSelectors("improve the UI layout")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for 'ux' keyword", () => {
    const result = inferSelectors("enhance UX experience")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for 'design' keyword", () => {
    const result = inferSelectors("update the design system")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for 'layout' keyword", () => {
    const result = inferSelectors("fix the page layout")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for 'accessibility' keyword", () => {
    const result = inferSelectors("add accessibility support")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for Chinese keyword '页面'", () => {
    const result = inferSelectors("修改页面样式")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for Chinese keyword '界面'", () => {
    const result = inferSelectors("优化界面交互")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for Chinese keyword '交互'", () => {
    const result = inferSelectors("改进交互效果")
    expect(result).toContain("ui_review")
  })

  test("adds ui_review for Chinese keyword '体验'", () => {
    const result = inferSelectors("提升用户体验")
    expect(result).toContain("ui_review")
  })

  // Code quality keywords
  test("adds code_quality for 'code quality' keyword", () => {
    const result = inferSelectors("improve code quality")
    expect(result).toContain("code_quality")
  })

  test("adds code_quality for 'refactor' keyword", () => {
    const result = inferSelectors("refactor the module")
    expect(result).toContain("code_quality")
  })

  test("adds code_quality for 'readab' partial match", () => {
    const result = inferSelectors("improve readability of the code")
    expect(result).toContain("code_quality")
  })

  test("adds code_quality for Chinese '代码质量'", () => {
    const result = inferSelectors("提升代码质量")
    expect(result).toContain("code_quality")
  })

  test("adds code_quality for Chinese '可维护'", () => {
    const result = inferSelectors("提高可维护性")
    expect(result).toContain("code_quality")
  })

  test("adds code_quality for Chinese '可读'", () => {
    const result = inferSelectors("提升可读性")
    expect(result).toContain("code_quality")
  })

  // Code review keywords
  test("adds code_review for 'code review' keyword", () => {
    const result = inferSelectors("do a code review on the PR")
    expect(result).toContain("code_review")
  })

  test("adds code_review for 'cr' word boundary match", () => {
    const result = inferSelectors("perform a cr on this change")
    expect(result).toContain("code_review")
  })

  test("adds code_review for Chinese '代码评审'", () => {
    const result = inferSelectors("进行代码评审")
    expect(result).toContain("code_review")
  })

  test("adds code_review for Chinese '审查'", () => {
    const result = inferSelectors("安全审查")
    expect(result).toContain("code_review")
  })

  // Dead code keywords
  test("adds dead_code_review for 'dead code' keyword", () => {
    const result = inferSelectors("remove dead code")
    expect(result).toContain("dead_code_review")
  })

  test("adds dead_code_review for 'unused code' keyword", () => {
    const result = inferSelectors("clean up unused code")
    expect(result).toContain("dead_code_review")
  })

  test("adds dead_code_review for 'unused export' keyword", () => {
    const result = inferSelectors("find unused exports")
    expect(result).toContain("dead_code_review")
  })

  test("adds dead_code_review for 'obsolete' keyword", () => {
    const result = inferSelectors("remove obsolete functions")
    expect(result).toContain("dead_code_review")
  })

  test("adds dead_code_review for Chinese '死代码'", () => {
    const result = inferSelectors("清理死代码")
    expect(result).toContain("dead_code_review")
  })

  test("adds dead_code_review for Chinese '无用代码'", () => {
    const result = inferSelectors("移除无用代码")
    expect(result).toContain("dead_code_review")
  })

  test("adds dead_code_review for Chinese '废弃分支'", () => {
    const result = inferSelectors("清理废弃分支")
    expect(result).toContain("dead_code_review")
  })

  // Startup keywords
  test("adds startup for 'startup' keyword", () => {
    const result = inferSelectors("ensure the app startup works")
    expect(result).toContain("startup")
  })

  test("adds startup for 'server' keyword", () => {
    const result = inferSelectors("set up the server")
    expect(result).toContain("startup")
  })

  test("adds startup for 'boot' keyword", () => {
    const result = inferSelectors("the app should boot correctly")
    expect(result).toContain("startup")
  })

  test("adds startup for 'launch' keyword", () => {
    const result = inferSelectors("the app should launch properly")
    expect(result).toContain("startup")
  })

  test("adds startup for Chinese '启动'", () => {
    const result = inferSelectors("确保服务正常启动")
    expect(result).toContain("startup")
  })

  test("adds startup for Chinese '正常启动'", () => {
    const result = inferSelectors("应用正常启动")
    expect(result).toContain("startup")
  })

  // Multiple selectors triggered at once
  test("can trigger multiple optional selectors simultaneously", () => {
    const result = inferSelectors("refactor the ui layout and remove dead code, then do a code review")
    expect(result).toContain("ui_review")
    expect(result).toContain("code_quality") // "refactor"
    expect(result).toContain("dead_code_review") // "dead code"
    expect(result).toContain("code_review") // "code review"
  })

  // Case insensitivity
  test("matches are case insensitive", () => {
    const result = inferSelectors("Improve UI DESIGN and CODE QUALITY")
    expect(result).toContain("ui_review")
    expect(result).toContain("code_quality")
  })

  // No duplicates
  test("does not produce duplicate selectors", () => {
    const result = inferSelectors("test the build and lint")
    const unique = new Set(result)
    expect(result.length).toBe(unique.size)
  })
})

// ---------------------------------------------------------------------------
// inferGoalSelectors
// ---------------------------------------------------------------------------

describe("inferGoalSelectors", () => {
  test("returns undefined when no selectors match", () => {
    const result = inferGoalSelectors("implement a new feature", "feature works correctly")
    expect(result).toBeUndefined()
  })

  test("does NOT include default selectors by default", () => {
    // A goal with no matching keywords should return undefined, not defaults
    const result = inferGoalSelectors("create the module", "module is created")
    expect(result).toBeUndefined()
  })

  test("detects 'build' keyword in description", () => {
    const result = inferGoalSelectors("ensure the project can build", "no errors")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("build")
  })

  test("detects 'test' keyword in criteria", () => {
    const result = inferGoalSelectors("add test coverage", "all test suites pass")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("test")
  })

  test("detects 'lint' keyword", () => {
    const result = inferGoalSelectors("fix lint warnings", "no lint errors remain")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("lint")
  })

  test("detects 'verify' keyword and maps to verify_cmd", () => {
    const result = inferGoalSelectors("verify the output", "verification passes")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("verify_cmd")
  })

  test("detects ui_review from goal description", () => {
    const result = inferGoalSelectors("update the page layout", "UI renders correctly")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("ui_review")
  })

  test("detects code_quality from goal criteria", () => {
    const result = inferGoalSelectors("improve module", "code quality metrics pass review")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("code_quality")
  })

  test("detects startup from goal text", () => {
    const result = inferGoalSelectors("app startup succeeds", "server responds on port 3000")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("startup")
  })

  test("detects dead_code_review from goal text", () => {
    const result = inferGoalSelectors("remove dead code from utils", "no unused exports")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("dead_code_review")
  })

  test("combines description and criteria for matching", () => {
    const result = inferGoalSelectors("build the feature", "test it works")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("build")
    expect(result!.check_selector).toContain("test")
  })

  test("returns correct shape with check_selector array", () => {
    const result = inferGoalSelectors("build passes", "test passes, lint clean")
    expect(result).toBeDefined()
    expect(Array.isArray(result!.check_selector)).toBe(true)
    expect(result!.check_selector.length).toBeGreaterThanOrEqual(3)
  })

  test("Chinese keywords work in goal context", () => {
    const result = inferGoalSelectors("确保界面正常启动", "页面渲染正确")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("ui_review")
    expect(result!.check_selector).toContain("startup")
  })

  test("case insensitive matching", () => {
    const result = inferGoalSelectors("BUILD succeeds", "LINT clean")
    expect(result).toBeDefined()
    expect(result!.check_selector).toContain("build")
    expect(result!.check_selector).toContain("lint")
  })
})
