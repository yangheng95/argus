import { expect, mock, test } from "bun:test";
import { StreamingTextPartController } from "../src/components/text-part-model";

test("streaming appends keep the active block raw and render completed blocks once", () => {
  const renderMarkdown = mock((source: string) => `<p>${source}</p>`);
  const model = new StreamingTextPartController(renderMarkdown);

  model.update("intro", true);
  let state = model.update("intro more", true);
  expect(state.activeText).toBe("intro more");
  expect(state.frozenHtml).toEqual([]);
  expect(renderMarkdown).toHaveBeenCalledTimes(0);

  state = model.update("intro more\n\nnext", true);
  expect(state.activeText).toBe("next");
  expect(state.frozenHtml).toEqual(["<p>intro more</p>"]);
  expect(renderMarkdown.mock.calls.map((call) => call[0])).toEqual(["intro more"]);

  state = model.update("intro more\n\nnext tail", true);
  expect(state.activeText).toBe("next tail");
  expect(state.frozenHtml).toEqual(["<p>intro more</p>"]);
  expect(renderMarkdown).toHaveBeenCalledTimes(1);
});

test("incremental split preserves frozen HTML references while the tail grows", () => {
  const renderMarkdown = mock((source: string) => ({ html: `<p>${source}</p>` }) as unknown as string);
  const model = new StreamingTextPartController(renderMarkdown);

  let state = model.update("stable block\n\nactive", true);
  const frozen = state.frozenHtml[0];
  state = model.update("stable block\n\nactive tail", true);

  expect(state.frozenHtml[0]).toBe(frozen);
  expect(state.activeText).toBe("active tail");
  expect(renderMarkdown).toHaveBeenCalledTimes(1);
});

test("unclosed fences stream as one active block across blank lines until completion", () => {
  const renderMarkdown = mock((source: string) => `<p>${source}</p>`);
  const model = new StreamingTextPartController(renderMarkdown);

  let state = model.update("```ts\nconst a = 1;\n\nstill code", true);
  expect(state.frozenHtml).toEqual([]);
  expect(state.activeText).toBe("```ts\nconst a = 1;\n\nstill code");

  model.update("```ts\nconst a = 1;\n\nstill code\n```", true);
  expect(renderMarkdown).toHaveBeenCalledTimes(0);
  state = model.update("```ts\nconst a = 1;\n\nstill code\n```", false);

  expect(state.activeText).toBe("");
  expect(state.frozenHtml).toEqual(["<p>```ts\nconst a = 1;\n\nstill code\n```</p>"]);
  expect(renderMarkdown).toHaveBeenCalledTimes(1);
});

test("non-prefix text changes rebuild the frozen cache for the new text", () => {
  const renderMarkdown = mock((source: string) => `<p>${source}</p>`);
  const model = new StreamingTextPartController(renderMarkdown);

  model.update("old frozen\n\nold active", true);
  expect(renderMarkdown.mock.calls.map((call) => call[0])).toEqual(["old frozen"]);

  const state = model.update("new frozen\n\nnew active", true);

  expect(renderMarkdown.mock.calls.map((call) => call[0])).toEqual(["old frozen", "new frozen"]);
  expect(state.frozenHtml).toEqual(["<p>new frozen</p>"]);
  expect(state.activeText).toBe("new active");
});
