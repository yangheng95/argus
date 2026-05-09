import { afterEach, describe, expect, test } from "bun:test";
import { setBoardStore } from "../src/store/board";
import { setSettingsStore } from "../src/store/settings";
import { activeDirectory } from "../src/services/workspace";

describe("workspace active directory", () => {
  afterEach(() => {
    setBoardStore("board", null);
    setSettingsStore("directory", "");
  });

  test("uses selected task directory when settings directory is empty", () => {
    setSettingsStore("directory", "");
    setBoardStore("board", {
      task: {
        id: "task_1",
        directory: "D:/repo/from-task",
      },
    });

    expect(activeDirectory()).toBe("D:/repo/from-task");
  });

  test("selected task directory owns project-scoped controls over stale settings", () => {
    setSettingsStore("directory", "D:/repo/from-settings");
    setBoardStore("board", {
      task: {
        id: "task_2",
        directory: "D:/repo/from-task",
      },
    });

    expect(activeDirectory()).toBe("D:/repo/from-task");
  });
});
