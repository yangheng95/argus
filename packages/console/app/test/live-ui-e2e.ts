import { chromium } from "@playwright/test"
import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import os from "os"

const tmp = path.join(os.tmpdir(), `opencorvus-ui-live-${Date.now()}`)
mkdirSync(tmp, { recursive: true })
writeFileSync(
  path.join(tmp, "package.json"),
  JSON.stringify(
    {
      name: "opencorvus-ui-live",
      version: "1.0.0",
      scripts: {
        build: `bun -e "console.log('build ok')"`,
        lint: `bun -e "console.log('lint ok')"`,
        test: `bun -e "if (await Bun.file('SUMMARY.md').exists()) process.exit(0); process.exit(1)"`,
      },
    },
    null,
    2,
  ),
)
writeFileSync(path.join(tmp, "index.ts"), "export const hello = 1\n")

const browser = await chromium.launch({
  headless: true,
})
const page = await browser.newPage()

const result = {
  directory: tmp,
  taskId: "",
  boardUrl: "",
  finalStatus: "",
  summaryVisible: false,
  sessionVisible: false,
}

try {
  await page.goto("http://127.0.0.1:3000/tasks", {
    waitUntil: "networkidle",
    timeout: 60_000,
  })

  await page.getByLabel("Directory override").fill(tmp)
  await page.getByLabel("Title").fill("UI live task")
  await page
    .getByLabel("Request")
    .fill("Create a SUMMARY.md file describing the repository in a few concise bullets and ensure build, lint, and test all pass.")
  await page.getByLabel("Request ID").fill(`ui-live-${Date.now()}`)
  await page.getByLabel("Mirror task and later operator messages to Slack").check()
  await page.getByRole("button", { name: "Create task" }).click()

  await page.waitForURL(/\/board\?/, {
    timeout: 120_000,
  })
  result.boardUrl = page.url()
  const boardUrl = new URL(page.url())
  result.taskId = boardUrl.searchParams.get("task_id") ?? ""

  await page.waitForSelector('text=UI live task', {
    timeout: 60_000,
  })

  const taskStatus = page.locator('[data-component="meta-card"]').filter({ hasText: "Task" }).locator("strong")
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll('[data-component="meta-card"]')]
      const task = cards.find((item) => item.textContent?.includes("Task"))
      const value = task?.querySelector("strong")?.textContent?.trim()
      return value === "completed"
    },
    undefined,
    { timeout: 300_000 },
  )
  result.finalStatus = (await taskStatus.textContent())?.trim() ?? ""

  await page.getByRole("button", { name: "Results" }).click().catch(() => undefined)
  await page.waitForSelector("text=Changed files", {
    timeout: 60_000,
  })
  result.summaryVisible = await page.locator("text=SUMMARY.md").first().isVisible()

  await page.getByRole("button", { name: "Operator input" }).click().catch(() => undefined)
  await page.getByPlaceholder("Add a preference, tighten the scope, ask for a smaller diff, or leave an operator note.").fill(
    "Please keep any follow-up changes concise and avoid touching package metadata unless necessary.",
  )
  await page.getByRole("button", { name: "Send to task" }).click()

  await page.getByRole("button", { name: "Raw session" }).click().catch(() => undefined)
  await page.waitForSelector("text=assistant", {
    timeout: 60_000,
  })
  result.sessionVisible = true
} finally {
  await browser.close()
}

console.log(JSON.stringify(result, null, 2))
