import { describe, expect, test } from "bun:test";
import path from "node:path";

const overlayRoot = path.resolve(import.meta.dir, "..");

async function readSource(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text();
}

describe("TracePanel visibility", () => {
  test("gates fetches on component visibility and document visibility", async () => {
    const component = await readSource("src/components/TracePanel.tsx");

    expect(component).toContain("isVisible?: () => boolean");
    expect(component).toContain("const componentVisible = createMemo(() => props.isVisible?.() ?? true)");
    expect(component).toContain("if (!hasTarget() || !componentVisible()) return null");
    expect(component).toContain("if (typeof document !== \"undefined\" && document.hidden) return");
    expect(component).toContain("if (!componentVisible()) return");
    expect(component).toContain("!document.hidden && hasTarget() && componentVisible()");
  });

  test("card trace panel is visible only while the trace body is open", async () => {
    const card = await readSource("src/components/Card.tsx");

    expect(card).toContain("isVisible={() => traceOpen() && expanded()}");
  });
});
