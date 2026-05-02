import { describe, expect, test } from "bun:test";
import path from "node:path";

const overlayRoot = path.resolve(import.meta.dir, "..");

async function readSource(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text();
}

describe("ChangesPanel group visibility", () => {
  test("keeps every group chunk mounted while switching visible groups", async () => {
    const component = await readSource("src/components/ChangesPanel.tsx");
    const styles = await readSource("src/styles.css");

    expect(component).toContain('class="changes-list-chunk"');
    expect(component).toContain('data-active={');
    expect(component).not.toMatch(/<Show[\s\S]{0,240}changes-list-chunk/);
    expect(styles).toContain('.changes-list-chunk[data-active="false"]');
    expect(styles).toContain('display: none');
  });

  test("stores scroll position per group before restoring the next group", async () => {
    const component = await readSource("src/components/ChangesPanel.tsx");

    expect(component).toContain("const scrollByGroup = new Map<string, number>()");
    expect(component).toContain("scrollByGroup.set(id, listRef.scrollTop)");
    expect(component).toContain("listRef.scrollTop = nextTop");
    expect(component).toContain("const selectGroupID = (groupID: string)");
    expect(component).toContain("saveActiveGroupScroll()");
    expect(component).toContain("restoreGroupScroll(groupID)");
  });

  test("does not render row-level change status badges", async () => {
    const component = await readSource("src/components/ChangesPanel.tsx");

    expect(component).not.toContain('class="change-status"');
    expect(component).not.toContain("changeStatusLabel");
  });
});
