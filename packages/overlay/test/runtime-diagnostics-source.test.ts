import { describe, expect, test } from "bun:test";
import path from "node:path";

const source = await Bun.file(path.resolve(import.meta.dir, "../src/main.tsx")).text();

describe("overlay runtime diagnostics", () => {
  test("global runtime failures are routed to AppLog and notifications", () => {
    expect(source).toContain("function reportOverlayRuntimeError");
    expect(source).toContain('AppLog.error("runtime", scope');
    expect(source).toContain("notifyError({");
    expect(source).toContain('"error"');
    expect(source).toContain('"unhandledrejection"');
  });

  test("initApp failures are not console-only", () => {
    expect(source).toContain('reportOverlayRuntimeError("initApp", error)');
    expect(source).not.toContain("console.error(error)\n  } finally");
  });
});
