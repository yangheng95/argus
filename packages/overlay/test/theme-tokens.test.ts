import { describe, expect, test } from "bun:test";
import { roleOf } from "../src/utils/card-color";

const src = (path: string) => Bun.file(new URL(`../src/${path}`, import.meta.url)).text();

describe("overlay theme tokens", () => {
  test("root theme is light-first and exposes the canonical token surface", async () => {
    const styles = await src("styles.css");
    const root = styles.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(root).toContain("color-scheme: light");
    expect(root).toContain("--bg: #eef3ff");
    expect(root).toContain("--status-ok:");
    expect(root).toContain("--status-warn:");
    expect(root).toContain("--status-error:");
    expect(root).toContain("--status-info:");
    expect(root).toContain("--border-subtle:");
    expect(root).toContain("--border-normal:");
    expect(root).toContain("--motion-quick:");
    expect(root).toContain("--motion-normal:");
    expect(root).toContain("--motion-slow:");
    expect(root).toContain("--radius-pill:");
  });

  test("legacy status aliases and parallel token families are absent from source styles", async () => {
    const styles = `${await src("styles.css")}\n${await src("styles/card.css")}`;

    expect(styles).not.toMatch(/--(?:ok|warning|danger|info)\s*:/);
    expect(styles).not.toMatch(/var\(--(?:ok|warning|danger|info)\b/);
    expect(styles).not.toMatch(/--space-\d+\s*:/);
    expect(styles).not.toMatch(/--fs-[a-z-]+\s*:/);
  });

  test("card colour is role based, not stage-token based", async () => {
    const cardCss = await src("styles/card.css");
    const cardColor = await src("utils/card-color.ts");
    const cardComponent = await src("components/Card.tsx");
    const writer = await src("services/tree-writer.ts");

    expect(cardCss).toContain("--role-user:");
    expect(cardCss).toContain("--role-system:");
    expect(cardCss).toContain("--role-execution:");
    expect(cardCss).toContain("--role-review:");
    expect(cardColor).toContain("export function roleOf");
    expect(cardColor).not.toContain("stageAccent");
    expect(`${cardCss}\n${cardComponent}\n${writer}`).not.toContain("--card-stage");
    expect(writer).not.toContain("accent:");
  });

  test("stage names collapse into the four visual roles", () => {
    expect(roleOf("user")).toBe("user");
    expect(roleOf("assistant")).toBe("user");
    expect(roleOf("orchestrator")).toBe("system");
    expect(roleOf("build")).toBe("execution");
    expect(roleOf("tool")).toBe("execution");
    expect(roleOf("delivery")).toBe("review");
    expect(roleOf("integrity")).toBe("review");
    expect(roleOf("custom-agent")).toBe("system");
  });
});
