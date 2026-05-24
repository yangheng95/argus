import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./launch";

function cssRule(css: string, pattern: RegExp, label: string): string {
  const match = css.match(pattern)?.[0];
  if (!match) throw new Error(`missing CSS rule: ${label}`);
  return match;
}

test("browser keeps a long transcript pinned while offscreen rows use content visibility", async () => {
  const conversationCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8");
  const bubbleCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/chat-bubble.css"), "utf8");
  const cardCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/card.css"), "utf8");
  const structuredCardRule = cssRule(
    conversationCss,
    /\.chat-scroll > \.card,\s*\.chat-scroll > \.interaction-card\s*\{[^}]*\}/,
    "chat-scroll direct card containment",
  );
  const bubbleRowRule = cssRule(bubbleCss, /\.chat-bubble-row\s*\{[^}]*\}/, "chat bubble row containment");
  const cardRule = cssRule(cardCss, /\.card\s*\{[^}]*\}/, "base card");

  const browser = await launchBrowser(["--disable-dev-shm-usage"]);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 700 });
    await page.setContent(`
      <!doctype html>
      <style>
        :root {
          --ui-scale: 1;
          --conversation-card-inline-size: min(720px, 100%);
          --conversation-user-card-inline-size: min(560px, 80%);
          --conversation-system-card-inline-size: min(620px, 90%);
          --card-min-inline-size: 0px;
          --card-sticky-inline-size: 0px;
          --card-gap: 8px;
          --card-border: #d0d7de;
          --card-bg-0: #ffffff;
          --oc-border-width: 1px;
          --oc-radius-soft: 8px;
          --ui-duration-base: 0ms;
          --ui-timing-standard: linear;
        }
        body { margin: 0; background: #f6f8fa; }
        .chat-scroll {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          height: 420px;
          overflow-y: auto;
          overflow-anchor: auto;
          contain: layout;
          padding: 16px;
          gap: 8px;
        }
        ${cardRule}
        ${structuredCardRule}
        ${bubbleRowRule}
        .card { padding: 12px; min-height: 92px; }
        .card .card { min-height: 76px; margin: 8px 0 0; background: #f0f3f6; }
        .chat-bubble-row { min-height: 92px; }
        .chat-bubble {
          width: min(640px, 100%);
          min-height: 72px;
          padding: 12px;
          border: 1px solid #d0d7de;
          background: #fff;
          box-shadow: 0 16px 28px rgba(27, 31, 36, .20);
          box-sizing: border-box;
        }
      </style>
      <main id="scroll" class="chat-scroll" data-follow-lock="true"></main>
    `);

    const metrics = await page.evaluate(async () => {
      const scroll = document.getElementById("scroll") as HTMLElement;
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const appendCard = (index: number) => {
        const card = document.createElement("section");
        card.className = "card";
        card.textContent = `card ${index} ${"content ".repeat(18)}`;
        if (index % 9 === 0) {
          const nested = document.createElement("section");
          nested.className = "card nested-card";
          nested.textContent = `nested ${index} ${"detail ".repeat(14)}`;
          card.appendChild(nested);
        }
        scroll.appendChild(card);
      };
      const appendBubble = (index: number) => {
        const row = document.createElement("div");
        row.className = "chat-bubble-row";
        row.dataset.role = index % 2 === 0 ? "assistant" : "user";
        row.innerHTML = `<div class="chat-bubble">bubble ${index} ${"stream ".repeat(22)}</div>`;
        scroll.appendChild(row);
      };

      for (let i = 0; i < 180; i += 1) {
        if (i % 3 === 0) appendCard(i);
        else appendBubble(i);
      }
      scroll.scrollTop = scroll.scrollHeight;
      await frame();
      const initialTop = scroll.scrollTop;
      let minTop = initialTop;
      let maxDistance = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;

      for (let i = 180; i < 240; i += 1) {
        if (i % 3 === 0) appendCard(i);
        else appendBubble(i);
        scroll.scrollTop = scroll.scrollHeight;
        await frame();
        const distance = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
        minTop = Math.min(minTop, scroll.scrollTop);
        maxDistance = Math.max(maxDistance, distance);
      }

      const topCard = scroll.querySelector(":scope > .card") as HTMLElement;
      const nestedCard = scroll.querySelector(".nested-card") as HTMLElement;
      const bubbleRows = Array.from(scroll.querySelectorAll(".chat-bubble-row")) as HTMLElement[];
      const bubbleRow = bubbleRows[bubbleRows.length - 1]!;
      const bubble = scroll.querySelector(".chat-bubble") as HTMLElement;
      const bubbleRect = bubble.getBoundingClientRect();
      const rowRect = bubbleRow.getBoundingClientRect();

      return {
        finalDistance: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        finalTop: scroll.scrollTop,
        initialTop,
        minTop,
        maxDistance,
        topCardContentVisibility: getComputedStyle(topCard).contentVisibility,
        nestedCardContentVisibility: getComputedStyle(nestedCard).contentVisibility,
        bubbleRowContentVisibility: getComputedStyle(bubbleRow).contentVisibility,
        bubbleRowOverflowClipMargin: getComputedStyle(bubbleRow).overflowClipMargin,
        bubbleFitsWithinClipMargin: bubbleRect.left >= rowRect.left - 28 && bubbleRect.right <= rowRect.right + 28,
      };
    });

    expect(metrics.topCardContentVisibility).toBe("auto");
    expect(metrics.bubbleRowContentVisibility).toBe("auto");
    expect(metrics.nestedCardContentVisibility).toBe("visible");
    expect(metrics.bubbleRowOverflowClipMargin).not.toBe("0px");
    expect(metrics.bubbleFitsWithinClipMargin).toBe(true);
    expect(metrics.minTop).toBeGreaterThanOrEqual(metrics.initialTop);
    expect(metrics.maxDistance).toBeLessThanOrEqual(2);
    expect(metrics.finalDistance).toBeLessThanOrEqual(2);
    expect(metrics.finalTop).toBeGreaterThanOrEqual(metrics.initialTop);

    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
  }
});
