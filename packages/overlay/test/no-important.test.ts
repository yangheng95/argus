import { expect, test } from "bun:test";

test("overlay CSS keeps important usage restricted to reset-only constraints", async () => {
  const targets = [
    ["styles.css", await Bun.file(new URL("../src/styles.css", import.meta.url)).text()],
    ["styles/card.css", await Bun.file(new URL("../src/styles/card.css", import.meta.url)).text()],
  ] as const;

  const hits = targets.flatMap(([file, text]) =>
    text.split(/\r?\n/).flatMap((line, index) =>
      line.includes("!important") ? [{ file, line: index + 1, text: line.trim() }] : [],
    ),
  );

  expect(hits.length).toBeLessThanOrEqual(30);

  for (const hit of hits) {
    expect(
      /display:\s*none\s*!important/.test(hit.text) ||
        /animation:\s*none\s*!important/.test(hit.text) ||
        /cursor:\s*(?:row-resize|col-resize)\s*!important/.test(hit.text),
      `${hit.file}:${hit.line} uses !important outside reset constraints: ${hit.text}`,
    ).toBe(true);
  }
});
