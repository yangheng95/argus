import { describe, expect, test } from "bun:test";

import {
  describeToolCall,
  describeToolPart,
  normalizeToolStatus,
  normalizeToolPartRecord,
} from "../src/utils/tool";

describe("tool display helpers", () => {
  test("describes read_file calls with relative path detail", () => {
    const display = describeToolCall(
      "read_file",
      { file_path: "D:/workspace/app/src/main.ts", startLine: 3, endLine: 18 },
      { status: "completed" },
      "D:/workspace/app",
    );

    expect(display.icon).toBe("\uD83D\uDCC4");
    expect(display.detail).toBe("src/main.ts:3-18");
    expect(display.status).toBe("completed");
    expect(display.statusLabel.length).toBeGreaterThan(0);
  });

  test("extracts raw tool-call parts without inventing status", () => {
    const display = describeToolPart({
      type: "tool-call",
      toolName: "bash",
      input: { command: "ls -la" },
    });

    expect(display).not.toBeNull();
    expect(display?.label).toBe("bash");
    expect(display?.detail).toBe("ls -la");
    expect(display?.status).toBeUndefined();
    expect(display?.statusLabel).toBe("");
  });

  test("normalizes failed tool state to error", () => {
    expect(normalizeToolStatus("failed")).toBe("error");
    expect(describeToolPart({
      type: "tool",
      tool: "write_file",
      state: { status: "failed", input: { path: "src/out.ts" } },
    })?.status).toBe("error");
  });

  test("merges raw tool_result onto the same canonical tool part", () => {
    const call = normalizeToolPartRecord({
      type: "tool_call",
      id: "call_1",
      name: "read_file",
      input: '{"file_path":"README.md"}',
    });
    const result = normalizeToolPartRecord({
      type: "tool_result",
      id: "call_1",
      output: "README body",
    }, call) as any;

    expect(result.type).toBe("tool");
    expect(result.tool).toBe("read_file");
    expect(result.state.input).toEqual({ file_path: "README.md" });
    expect(result.state.output).toBe("README body");
    expect(result.state.status).toBe("completed");
  });
});