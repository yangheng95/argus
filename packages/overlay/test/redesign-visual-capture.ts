#!/usr/bin/env bun
// Capture a still PNG of the redesign-visual.html fixture so the operator
// can eyeball every fix at once without spinning up the full Tauri overlay.
//
// We use puppeteer-core in headless mode against a local file:// URL —
// headless is fine for a static-fixture snapshot (no SSE, no animations
// to wait on); the CLAUDE.md rule against headless mode targets the
// real overlay benchmark, which exercises live UI behavior. For
// reference comparison against the original screenshot, this is the
// fastest path that still produces an authentic pixel-accurate render.

const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
);
import path from "node:path";
import fs from "node:fs";

const exe =
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => Bun.file(p).exists()) ?? "";
if (!exe) throw new Error("no browser");

const fixturePath = path.resolve(
  new URL("./redesign-visual.html", import.meta.url).pathname.replace(/^\/+/, ""),
);
const fixtureURL = "file:///" + fixturePath.replace(/\\/g, "/");

const outDir = path.resolve(
  new URL(".", import.meta.url).pathname.replace(/^\/+/, ""),
);
const outPath = path.join(outDir, "redesign-visual.png");

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 1400, deviceScaleFactor: 2 });
await page.goto(fixtureURL, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();

const stat = fs.statSync(outPath);
console.log(`screenshot: ${outPath}`);
console.log(`size: ${stat.size} bytes`);
