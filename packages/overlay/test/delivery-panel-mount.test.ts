import { expect, test } from "bun:test";
import path from "node:path";

const overlayRoot = path.resolve(import.meta.dir, "..");

async function readSrc(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text();
}

// Regression for "no delivery card visible during bench":
// commit beb81a2af (Scope delivery rejections and evidence cards) defined and
// exported `DeliveryPanel` in components/Board.tsx, but the component was
// never imported or rendered anywhere — so even though the bench server kept
// emitting `delivery.ready` / `delivery.evidence.updated` and the board
// hydrated `candidateDelivery.evidenceManifest`, the overlay UI rendered no
// delivery card at all. This suite locks the wiring in place: a DOM mount
// node, an import in main.tsx, and a render() call against that node.

test("index.html declares the #solidDeliveryMount node so DeliveryPanel has a place to render", async () => {
  const html = await readSrc("src/index.html");
  expect(html).toContain('id="solidDeliveryMount"');
});

test("main.tsx imports DeliveryPanel and mounts it at #solidDeliveryMount", async () => {
  const main = await readSrc("src/main.tsx");
  expect(main).toContain('import { DeliveryPanel }');
  expect(main).toContain('document.getElementById("solidDeliveryMount")');
  expect(main).toContain("<DeliveryPanel");
});

test("DeliveryPanel is exported from components/Board.tsx", async () => {
  const board = await readSrc("src/components/Board.tsx");
  expect(board).toMatch(/export\s+function\s+DeliveryPanel/);
});
