import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"
import { generalExpertSquadCatalog } from "./expert-squad-fixture.ts"

await ensureOverlayDist()

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function eventStream() {
  return new Response(":\n\n", {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  })
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function saveElementScreenshot(page: any, selector: string, filename: string) {
  const screenshotPath = resolve(".scratch", filename)
  mkdirSync(dirname(screenshotPath), { recursive: true })
  const element = await page.$(selector)
  assert.ok(element, `${selector} should exist before screenshot`)
  writeFileSync(screenshotPath, await element.screenshot({}))
  return screenshotPath
}

test("interaction custom replies reuse the auto-growing textarea primitive in inline and dialog surfaces", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const now = Date.now()
  const taskID = "task-interaction-textarea"
  const projectRoot = "D:/overlay/workspace/interaction-textarea"
  const task = {
    id: taskID,
    title: "Interaction textarea fixture",
    directory: projectRoot,
    status: "active",
    sessionID: "session-interaction-textarea",
    time: { created: now - 30_000, started: now - 25_000, updated: now - 1_000 },
  }
  const interaction = {
    id: "question-autogrow",
    type: "question",
    status: "pending",
    title: "Choose deployment notes",
    time: { created: now - 5_000 },
    payload: {
      questions: [
        {
          header: "Deployment notes",
          question: "What extra context should the agent include?",
          multiple: false,
          custom: true,
          options: [
            { label: "Risk summary", description: "Include known risks and mitigations." },
            { label: "QA notes", description: "Include verification details." },
          ],
        },
        {
          header: "Approval scope",
          question: "Which approvals are covered?",
          multiple: true,
          custom: false,
          options: [
            { label: "Product owner", description: "Approval from the product owner." },
            { label: "QA owner", description: "Approval from the QA owner." },
          ],
        },
        {
          header: "Freeform detail",
          question: "Add any other details.",
          multiple: false,
          custom: true,
          options: [],
        },
      ],
    },
  }
  const board = {
    snapshotVersion: "interaction-textarea-board",
    lastSequence: 0,
    task,
    overview: {
      headline: "Interaction textarea fixture",
      summary: "Exercises question custom reply textarea in both surfaces.",
      controls: {},
    },
    goalWorkflows: [],
    requirements: [],
    changes: [],
    interactions: [interaction],
  }
  const replyStarted = deferred()
  const releaseReply = deferred()
  let replyRequestCount = 0

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const path = route(url)
    if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
    if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
    const staticResponse = await overlayStaticResponse(path)
    if (staticResponse) return staticResponse
    if (path === "/global/health") return send({ version: "interaction-textarea" })
    if (path === "/global/projects/discover")
      return send({ root: "D:/overlay", defaultDirectory: projectRoot, projects: [] })
    if (path === "/global/tasks") return send({ tasks: [{ task, updated_at: now - 1_000 }] })
    if (path === "/mission") return send([])
    if (path === "/executor")
      return send([{ id: "opencorvus", label: "OpenCorvus", selectable: true, discovered: true }])
    if (path === "/terminal/profiles" || path === "/coding/cli/profiles") return send({ profiles: [] })
    if (path === "/project/current/worktrees") return send([])
    if (path === "/path") return send({ directory: projectRoot })
    if (path === "/vcs")
      return send({
        branch: "interaction-textarea",
        clean: true,
        dirty: false,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicts: 0,
        ahead: 0,
        behind: 0,
      })
    if (path === "/provider") return send({ all: [], connected: [], default: {} })
    if (path === "/provider/auth") return send({})
    if (path === "/agent") return send([])
    if (path === "/config/providers") return send({ providers: [], default: {} })
    if (path === "/config/prompt") return send([])
    if (path === "/expert-squad/catalog")
      return send(generalExpertSquadCatalog())
    if (path === "/config") return send({ model: "opencorvus/gpt-5-nano" })
    if (path === "/channel") return send([])
    if (path === "/skill/installed" || path === "/skill" || path === "/skill/market") return send([])
    if (path === "/skill/directories")
      return send({
        global_config: "D:/skills/config",
        managed_skills: "D:/skills/config/skills-market",
        remote_cache: "D:/skills/cache",
      })
    if (path === "/mcp") return send({})
    if (path === "/session") return send([])
    if (path === "/control/timeline") return send([])
    if (path === `/task/${taskID}/board`) return send(board, { headers: { etag: `"board-${now}"` } })
    if (path === `/task/${taskID}/conversation`)
      return send({
        board,
        transcript: [],
        timeline: [],
        events: [],
        view: { topLevelSessionIDs: [], sessions: [], messages: [] },
        eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
        lastSequence: 0,
      })
    if (path === `/task/${taskID}/operator-model-context`)
      return send({ taskID, sessionID: "session-interaction-textarea", agent: "orchestrator", model: null })
    if (path === `/task/${taskID}/browser-preview`) return send({ target: null, verification: null })
    if (path === `/task/${taskID}/conversation/events`)
      return send({ events: [], eventReplay: { cursor: 0, latestSequence: 0 } })
    if (path === `/task/${taskID}/transcript`) return send([])
    if (path === `/task/${taskID}/trace`) return send({ events: [], traceDir: `${projectRoot}/.opencorvus/trace` })
    if (path === "/task/events" || path === `/task/${taskID}/events`) return eventStream()
    if (path === "/interaction/question-autogrow/reply" && req.method === "POST") {
      replyRequestCount += 1
      replyStarted.resolve()
      await releaseReply.promise
      return send({ message: "Fixture rejected answer" }, { status: 400 })
    }
    if (path === "/panel/knowledge/memory" || path === "/panel/knowledge/preference") return send([])
    if (path === "/log" && req.method === "POST") return send({ ok: true })
    return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on("pageerror", (error: any) => errors.push(`pageerror: ${error.message || String(error)}`))
    page.on("console", (message: any) => {
      const expectedReplyFailure =
        message.type() === "error" && replyRequestCount > 0 && message.text().includes("status of 400")
      if (message.type() === "error" && !expectedReplyFailure) errors.push(`console: ${message.text()}`)
    })
    page.on("response", (response: any) => {
      const expectedReplyFailure =
        response.status() === 400 && response.url().includes("/interaction/question-autogrow/reply")
      if (response.status() >= 400 && !expectedReplyFailure) errors.push(`${response.status()} ${response.url()}`)
    })
    await page.setViewport({ width: 1280, height: 860 })
    await page.evaluateOnNewDocument(
      (seed: { serverUrl: string; taskID: string; projectRoot: string }) => {
        localStorage.setItem("oc_locale", "en-US")
        localStorage.setItem("oc_theme", "light")
        localStorage.setItem("oc_server_url", seed.serverUrl)
        localStorage.setItem("oc_auto_server", "false")
        localStorage.setItem("oc_directory", seed.projectRoot)
        localStorage.setItem("oc_workspace_directory", seed.projectRoot)
        localStorage.setItem("oc_workspace_task", seed.taskID)
      },
      { serverUrl: server.origin, taskID, projectRoot },
    )

    await page.goto(`${server.origin}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('[data-ui="side-activity-button"][data-side="right"]')
    await page.waitForFunction(
      () =>
        typeof (window as any).applyDirectory === "function" &&
        typeof (window as any).loadTasks === "function" &&
        typeof (window as any).selectTask === "function",
    )
    await page.evaluate(
      async (seed: { taskID: string; projectRoot: string }) => {
        await (window as any).applyDirectory(seed.projectRoot, { persist: false, restoreWorkspace: false, save: false })
        await (window as any).loadTasks()
        await (window as any).selectTask(seed.taskID, { directory: seed.projectRoot })
      },
      { taskID, projectRoot },
    )

    await page
      .waitForFunction(
        () => document.querySelectorAll('.interaction-card[data-id="question-autogrow"] textarea').length >= 4,
        { timeout: 15_000 },
      )
      .catch(async (error: unknown) => {
        const state = await page.evaluate(() => ({
          cards: Object.keys((window as any).cardTree?.cards ?? {}),
          boardInteractions: (window as any).boardStore?.board?.interactions ?? null,
          selectedSource: (window as any).boardStore?.selectedSource ?? null,
          taskSwitching: (window as any).boardStore?.taskSwitching ?? null,
          interactionCount: document.querySelectorAll(".interaction-card").length,
          bodySample: document.body.textContent?.slice(0, 1000) ?? "",
        }))
        throw new Error(`interaction textarea fixture did not render: ${JSON.stringify(state)}`, { cause: error })
      })

    const before = await page.evaluate(() => {
      const inline = document.querySelector<HTMLTextAreaElement>(
        '.chat-scroll .interaction-card[data-id="question-autogrow"] textarea',
      )
      const dialog = document.querySelector<HTMLTextAreaElement>(
        '#interactionDialog .interaction-card[data-id="question-autogrow"] textarea',
      )
      if (!inline || !dialog) throw new Error("missing interaction textareas")
      return {
        inlineClass: inline.className,
        dialogClass: dialog.className,
        inlineResize: getComputedStyle(inline).resize,
        dialogResize: getComputedStyle(dialog).resize,
        inlineOverflow: getComputedStyle(inline).overflowY,
        dialogOverflow: getComputedStyle(dialog).overflowY,
        inlineHeight: inline.getBoundingClientRect().height,
        dialogHeight: dialog.getBoundingClientRect().height,
        semantics: [".chat-scroll", "#interactionDialog"].map((scopeSelector) => {
          const scope = document.querySelector<HTMLElement>(scopeSelector)
          const card = scope?.querySelector<HTMLElement>('.interaction-card[data-id="question-autogrow"]')
          if (!card) throw new Error(`missing card in ${scopeSelector}`)
          return {
            fieldsets: Array.from(card.querySelectorAll("fieldset.interaction-card__question")).map((fieldset) => {
              const legend = fieldset.querySelector("legend")
              return {
                label: legend?.textContent?.trim() ?? "",
                labelledBy: fieldset.getAttribute("aria-labelledby") ?? "",
                legendID: legend?.id ?? "",
              }
            }),
            textareas: Array.from(card.querySelectorAll<HTMLTextAreaElement>("textarea")).map((textarea) => {
              const labelID = textarea.getAttribute("aria-labelledby") ?? ""
              return {
                placeholder: textarea.getAttribute("placeholder") ?? "",
                labelledBy: labelID,
                label: labelID ? (document.getElementById(labelID)?.textContent?.trim() ?? "") : "",
              }
            }),
            describedOptions: Array.from(card.querySelectorAll<HTMLInputElement>("input[aria-describedby]")).map(
              (input) => {
                const descID = input.getAttribute("aria-describedby") ?? ""
                return {
                  descID,
                  description: document.getElementById(descID)?.textContent?.trim() ?? "",
                }
              },
            ),
            buttons: Array.from(card.querySelectorAll<HTMLButtonElement>("button[data-action]")).map((button) => ({
              text: button.textContent?.trim() ?? "",
              ariaLabel: button.getAttribute("aria-label"),
              title: button.getAttribute("title") ?? "",
            })),
          }
        }),
      }
    })
    assert.match(before.inlineClass, /\bcomposer-textarea\b/)
    assert.match(before.inlineClass, /\binteraction-card__custom-input\b/)
    assert.equal(before.dialogClass, before.inlineClass)
    assert.equal(before.inlineResize, "none")
    assert.equal(before.dialogResize, "none")
    assert.equal(before.inlineOverflow, "auto")
    assert.equal(before.dialogOverflow, "auto")
    for (const surface of before.semantics) {
      assert.deepEqual(
        surface.fieldsets.map((item) => item.label),
        [
          "Deployment notes: What extra context should the agent include?",
          "Approval scope: Which approvals are covered?",
          "Freeform detail: Add any other details.",
        ],
      )
      for (const fieldset of surface.fieldsets) {
        assert.ok(fieldset.labelledBy, "fieldset should reference its legend")
        assert.equal(fieldset.labelledBy, fieldset.legendID)
      }
      assert.deepEqual(
        surface.textareas.map((item) => item.label),
        ["Deployment notes: What extra context should the agent include?", "Freeform detail: Add any other details."],
      )
      for (const textarea of surface.textareas) {
        assert.equal(textarea.placeholder, "Or type a custom answer…")
        assert.ok(textarea.labelledBy, "textarea should use a real question label, not only placeholder text")
      }
      assert.deepEqual(
        surface.describedOptions.map((item) => item.description).sort(),
        [
          "Approval from the product owner.",
          "Approval from the QA owner.",
          "Include known risks and mitigations.",
          "Include verification details.",
        ].sort(),
      )
      assert.deepEqual(
        surface.buttons.map((button) => button.text),
        ["Answer", "Skip"],
      )
      for (const button of surface.buttons) {
        assert.equal(button.ariaLabel, null)
        assert.ok(button.title)
      }
    }

    const longReply = [
      "Line one: include the release risk summary.",
      "Line two: include the visual QA screenshots.",
      "Line three: include the keyboard focus checks.",
      "Line four: include the rollback plan.",
      "Line five: include the owner and timestamp.",
    ].join("\n")
    await page.$eval(
      '.chat-scroll .interaction-card[data-id="question-autogrow"] textarea',
      (node, value) => {
        const textarea = node as HTMLTextAreaElement
        textarea.value = value as string
        textarea.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: value as string }),
        )
      },
      longReply,
    )

    const after = await page.$eval(
      '.chat-scroll .interaction-card[data-id="question-autogrow"] textarea',
      (node) => (node as HTMLTextAreaElement).getBoundingClientRect().height,
    )
    assert.ok(after > before.inlineHeight, `inline textarea should auto-grow: ${before.inlineHeight} -> ${after}`)

    const dialogScreenshot = await saveElementScreenshot(
      page,
      "#interactionDialog",
      "interaction-card-textarea-dialog.png",
    )
    await page.click('#interactionDialog .interaction-card[data-id="question-autogrow"] [data-action="answer"]')
    await replyStarted.promise
    const busyState = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        '#interactionDialog .interaction-card[data-id="question-autogrow"]',
      )
      if (!card) throw new Error("missing dialog card")
      return {
        busy: card.getAttribute("aria-busy"),
        statusText:
          card
            .querySelector<HTMLElement>('[role="status"][aria-live="polite"][aria-busy="true"]')
            ?.textContent?.trim() ?? "",
        disabledButtons: Array.from(card.querySelectorAll<HTMLButtonElement>("button[data-action]")).map(
          (button) => button.disabled,
        ),
        disabledInputs: Array.from(
          card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
        ).map((control) => control.disabled),
        focusInside: card.contains(document.activeElement),
      }
    })
    assert.equal(busyState.busy, "true")
    assert.equal(busyState.statusText, "Submitting response…")
    assert.deepEqual(busyState.disabledButtons, [true, true])
    assert.ok(busyState.disabledInputs.every(Boolean))
    assert.equal(busyState.focusInside, true)

    releaseReply.resolve()
    await page.waitForSelector(
      '#interactionDialog .interaction-card[data-id="question-autogrow"] [role="alert"][aria-live="assertive"]',
      { timeout: 10_000 },
    )
    const failureState = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(
        '#interactionDialog .interaction-card[data-id="question-autogrow"]',
      )
      const alert = card?.querySelector<HTMLElement>('[role="alert"][aria-live="assertive"]')
      if (!card || !alert) throw new Error("missing failure alert")
      return {
        busy: card.getAttribute("aria-busy"),
        alertText: alert.textContent?.trim() ?? "",
        alertAtomic: alert.getAttribute("aria-atomic"),
        focusInside: card.contains(document.activeElement),
        activeIsAlert: document.activeElement === alert,
      }
    })
    assert.equal(failureState.busy, "false")
    assert.match(failureState.alertText, /Fixture rejected answer/)
    assert.equal(failureState.alertAtomic, "true")
    assert.equal(failureState.focusInside, true)
    assert.equal(failureState.activeIsAlert, true)
    assert.equal(replyRequestCount, 1)
    const errorScreenshot = await saveElementScreenshot(
      page,
      '#interactionDialog .interaction-card[data-id="question-autogrow"]',
      "interaction-card-error-dialog.png",
    )
    await page.keyboard.press("Escape")
    await page.waitForFunction(
      () => !document.querySelector('#interactionDialog .interaction-card[data-id="question-autogrow"]'),
    )
    const inlineScreenshot = await saveElementScreenshot(
      page,
      '.chat-scroll .interaction-card[data-id="question-autogrow"]',
      "interaction-card-textarea-inline.png",
    )
    assert.ok(inlineScreenshot.endsWith("interaction-card-textarea-inline.png"))
    assert.ok(dialogScreenshot.endsWith("interaction-card-textarea-dialog.png"))
    assert.ok(errorScreenshot.endsWith("interaction-card-error-dialog.png"))
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await server.close()
  }
})
