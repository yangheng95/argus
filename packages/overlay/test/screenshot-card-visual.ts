#!/usr/bin/env bun
/**
 * Screenshot the card-visual.html fixture for S2 visual verification.
 * Splits the page into numbered sections so each PNG stays under the
 * auto-downscale threshold and remains legible.
 */

import path from "node:path";
import { launchBrowser } from "./launch";

const fixtureURL =
  "file:///" +
  path.resolve(new URL("./card-visual.html", import.meta.url).pathname.replace(/^\/+/, "")).replace(/\\/g, "/");

const outDir = path.resolve(
  new URL("../../../docs/cards-visual/", import.meta.url).pathname.replace(/^\/+/, ""),
);
await Bun.$`mkdir -p ${outDir}`.quiet().catch(() => {});

const browser = await launchBrowser(["--no-sandbox", "--disable-gpu"]);
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 900, height: 3000 });
  await page.goto(fixtureURL, { waitUntil: "load", timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 400));

  // One shot per section (h2), using absolute offset* for height measurement
  // so content beyond the initial viewport is still correctly included.
  const sections = await page.$$eval("h2", (els) =>
    els.map((el, i) => {
      const h2 = el as HTMLElement;
      const top = h2.offsetTop;
      let bottom = top + h2.offsetHeight;
      let sib = el.nextElementSibling as HTMLElement | null;
      while (sib && sib.tagName !== "H2") {
        bottom = Math.max(bottom, sib.offsetTop + sib.offsetHeight);
        sib = sib.nextElementSibling as HTMLElement | null;
      }
      return { i, x: 10, y: Math.max(0, top - 10), w: 860, h: bottom - top + 30 };
    }),
  );

  for (const s of sections) {
    const out = path.join(outDir, `card-visual-s${s.i + 1}.png`);
    await page.screenshot({
      path: out as `${string}.png`,
      clip: { x: s.x, y: s.y, width: s.w, height: s.h },
    });
    console.log(`s${s.i + 1} → ${out}`);
  }

  // Also a single full page for overview
  const full = path.join(outDir, "card-visual-full.png");
  await page.screenshot({ path: full as `${string}.png`, fullPage: true });
  console.log("full →", full);
} finally {
  await browser.close();
}
