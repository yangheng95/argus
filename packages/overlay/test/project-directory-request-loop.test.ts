import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OVERLAY_ROOT = join(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8");
}

describe("overlay project directory request loop", () => {
  test("API configuration waits for settings hydration before reading active directory", () => {
    const source = read("src/main.tsx");
    expect(source).toMatch(
      /createEffect\(\(\) => \{\s*if \(!settingsHydrated\(\)\) return\s*configureApi\(\{/,
    );
  });

  test("skill market auto-load is keyed by active directory, not empty catalogue state", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx");
    expect(source).toContain("const [loadedMarketDirectory, setLoadedMarketDirectory] = createSignal(\"\");");
    expect(source).toContain("const directory = activeDirectory();");
    expect(source).toContain('props.mode !== "skill-market" || props.active !== true');
    expect(source).toContain("if (loadedMarketDirectory() === directory) return;");
    expect(source).not.toContain("market().length === 0");
  });

  test("MCP panel refreshes while backend connection state is still pending", () => {
    const source = read("src/components/settings/SkillMarketPanel.tsx");
    expect(source).toContain("const hasConnectingMcp = createMemo");
    expect(source).toContain("item?.status === \"connecting\"");
    expect(source).toContain('props.mode !== "mcp" || props.active !== true || !hasConnectingMcp()');
    expect(source).toContain("window.setTimeout");
    expect(source).toContain("loadExtensions().catch");
    expect(source).toContain("window.clearTimeout(timer)");
  });

  test("extension loaders surface request failures instead of rewriting stores to empty values", () => {
    const source = read("src/services/extensions.ts");
    expect(source).toContain('apiJson("skill/installed")');
    expect(source).not.toContain('apiJson("skill/installed").catch');
    expect(source).not.toContain('apiJson("skill")');
    expect(source).not.toContain("setSkills([])");
    expect(source).not.toContain("setMcp({})");
    expect(source).not.toContain("setSkillMarket([])");
  });
});
