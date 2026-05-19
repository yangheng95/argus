import { expect, test } from "bun:test";
import { launchBrowser } from "./launch";
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist";

await ensureOverlayDist();

const TASK_ID = "tsk_delivery_review_ui";
const REVIEW_ID = `delivery:${TASK_ID}:0`;

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers || {}) },
  });
}

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

test("delivery review card is readable while running and after host-gate rejection", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const now = Date.now();
  const task = {
    id: TASK_ID,
    title: "Delivery review UI",
    directory: "D:/overlay/workspace/app",
    status: "running",
    sessionID: "ses_root_delivery_review_ui",
    time: { created: now - 20_000, updated: now - 1_000 },
  };
  const board = {
    task,
    run: { executor: "opencorvus", phase: "delivery" },
    overview: { headline: "Delivery review UI", summary: "", controls: {} },
    plan: null,
    spec: null,
    evaluation: null,
    delivery: null,
    interactions: [],
  };

  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 });
      if (path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302);
      const staticResponse = await overlayStaticResponse(path);
      if (staticResponse) return staticResponse;

      if (path === "/__complete" && req.method === "POST") {
        streamController?.enqueue(encoder.encode(sse({
          type: "delivery.review.completed",
          emittedAt: now + 3_000,
          properties: {
            taskID: TASK_ID,
            reviewID: REVIEW_ID,
            verdict: "rejected",
            source: "host_gate",
            summary: "Host gate rejected delivery",
            hostGatePassed: false,
            failureKinds: ["runtime"],
            rejectionCount: 1,
            deferredCount: 0,
            details: ["Runtime render produced no visible app shell"],
          },
        })));
        return json({ ok: true });
      }

      if (path === "/global/health") return json({ version: "1.2.3" });
      if (path === "/tasks" || path === "/global/tasks") return json({ tasks: [{ task, updated_at: now - 1_000 }] });
      if (path === "/session") return json([]);
      if (path === "/config/prompt") return json([]);
      if (path === "/path") return json({ directory: task.directory });
      if (path === "/vcs") return json({
        branch: "dev", clean: true, dirty: false,
        staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0,
      });
      if (path === "/config") return json({});
      if (path === "/provider") return json({ all: [], connected: [], default: {} });
      if (path === "/provider/auth") return json({});
      if (path === "/agent") return json([]);
      if (path === "/config/providers") return json({ providers: [], default: {} });
      if (path === "/channel") return json([]);
      if (path === "/executor") return json([{
        id: "opencorvus", label: "OpenCorvus", detail: "Bundled",
        version: "0.0.1-alpha", selectable: true, discovered: true,
      }]);
      if (path === "/skill/installed" || path === "/skill") return json([]);
      if (path === "/mcp") return json({});
      if (path === "/panel/knowledge/memory") return json([]);
      if (path === "/panel/knowledge/preference") return json([]);
      if (path === "/log/tail") return json({ path: "D:/overlay/logs/server.log", lines: [] });
      if (path === "/log" && req.method === "POST") return json(true);
      if (path === `/task/${TASK_ID}/board`) return json(board);
      if (path === `/task/${TASK_ID}/conversation`) {
        return json({
          board,
          transcript: [],
          timeline: [],
          events: [],
          view: { sessions: [] },
          eventReplay: { cursor: 0, latestSequence: 0, complete: true, limit: 100 },
          lastSequence: 0,
        });
      }
      if (path === "/task/events") {
        return new Response(":\n\n", {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        });
      }
      if (path === `/task/${TASK_ID}/events`) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            controller.enqueue(encoder.encode(sse({
              type: "review.stream.started",
              emittedAt: now + 1_000,
              properties: { taskID: TASK_ID, reviewID: REVIEW_ID, phase: "delivery" },
            })));
            controller.enqueue(encoder.encode(sse({
              type: "review.stream.progress",
              emittedAt: now + 2_000,
              properties: {
                taskID: TASK_ID,
                reviewID: REVIEW_ID,
                phase: "delivery",
                currentStep: "runtime",
                attempt: 1,
                elapsedMs: 1_000,
                summary: "Runtime evidence still running",
              },
            })));
          },
          cancel() {
            streamController = undefined;
          },
        }), {
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        });
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    },
  });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const base = `http://127.0.0.1:${server.port}`;
    const diagnostics: string[] = [];
    page.on("console", (msg) => diagnostics.push(`console:${msg.type()}:${msg.text()}`));
    page.on("requestfailed", (req) => diagnostics.push(`requestfailed:${req.url()}:${req.failure()?.errorText || ""}`));
    await page.evaluateOnNewDocument((serverUrl) => {
      (window as unknown as Record<string, unknown>).__TAURI__ = {
        core: {
          invoke: async (command: string) => {
            if (command === "overlay_settings_load") {
              return { serverUrl, autoServer: false, directory: "D:/overlay/workspace/app" };
            }
            if (command === "overlay_settings_save") return true;
            if (command === "overlay_open_url" || command === "overlay_open_path") return true;
            if (command === "overlay_create_temp_dir") return "D:/overlay/temp";
            return null;
          },
        },
        window: {
          getCurrentWindow() {
            return {
              close: async () => undefined, minimize: async () => undefined,
              startDragging: async () => undefined, isMaximized: async () => false,
              onResized: async () => ({ unlisten: async () => undefined }),
            };
          },
        },
      };
    }, base);

    await page.goto(`${base}/ui/index.html`, { waitUntil: "networkidle2", timeout: 20_000 });
    await page.waitForSelector(`[data-task-id="${TASK_ID}"]`, { timeout: 20_000 });
    await page.click(`[data-task-id="${TASK_ID}"]`);
    try {
      await page.waitForSelector(`[data-card-id="review:delivery:${TASK_ID}:0"]`, { timeout: 20_000 });
    } catch (error) {
      const text = await page.evaluate(() => document.body.textContent?.replace(/\s+/g, " ").slice(0, 1000));
      throw new Error(`delivery review card did not mount; text=${text}; diagnostics=${diagnostics.slice(-20).join(" | ")}`, { cause: error });
    }
    await page.waitForFunction(
      () => document.body.textContent?.includes("Runtime evidence still running"),
      { timeout: 10_000 },
    );
    const runningText = await page.$eval(
      `[data-card-id="review:delivery:${TASK_ID}:0"]`,
      (node) => (node as HTMLElement).innerText,
    );
    expect(runningText).toContain("Runtime evidence still running");
    await page.screenshot({
      path: `${process.env.TEMP || process.env.TMPDIR || "/tmp"}/delivery-review-running.png` as `${string}.png`,
      fullPage: false,
    });

    const complete = await fetch(`${base}/__complete`, { method: "POST" });
    expect(complete.ok).toBe(true);
    await page.waitForFunction(
      () => document.body.textContent?.includes("Runtime render produced no visible app shell"),
      { timeout: 10_000 },
    );
    const completedText = await page.$eval(
      `[data-card-id="review:delivery:${TASK_ID}:0"]`,
      (node) => (node as HTMLElement).innerText,
    );
    expect(completedText).toContain("Host gate rejected delivery");
    expect(completedText).toContain("Runtime render produced no visible app shell");
    await page.screenshot({
      path: `${process.env.TEMP || process.env.TMPDIR || "/tmp"}/delivery-review-completed.png` as `${string}.png`,
      fullPage: false,
    });
  } finally {
    await browser.close();
    server.stop(true);
  }
});
