import { describe, expect, test } from "bun:test";
import path from "node:path";

const overlayRoot = path.resolve(import.meta.dir, "..");

async function readSource(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text();
}

describe("DiffView collapsed context", () => {
  test("preserves collapsed context data and exposes skip expansion", async () => {
    const component = await readSource("src/components/DiffView.tsx");

    expect(component).toContain("function collapseDiffOps");
    expect(component).toContain("hidden: chunk.slice(3, -3)");
    expect(component).toContain("skipID: `skip-${skipIndex}`");
    expect(component).toContain("const [expandedSkipIDs");
    expect(component).toContain("return op.hidden && op.hidden.length > 0 ? op.hidden : []");
  });

  test("renders each skip row as a button", async () => {
    const component = await readSource("src/components/DiffView.tsx");
    const styles = await readSource("src/styles.css");

    expect(component).toContain('class="diff-skip-button"');
    expect(component).toContain("onClick={() => expandSkip(line.skipID)}");
    expect(component).toContain('type="button"');
    expect(styles).toContain(".diff-skip-button");
  });
});
