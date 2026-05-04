import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __setHostTransportForTest } from "../src/services/host-transport";
import type {
  HostTransport,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport";
import { createTask, panelRequestBody } from "../src/services/task";
import {
  applySettings,
  bootstrapOverlaySettings,
  DEFAULT_SETTINGS,
  loadSettings,
  sanitizeExecutor,
  setSettingsStore,
  settingsStore,
} from "../src/store/settings";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return (await responder(req)) as TransportResponse<T>;
    },
    openStream() {
      throw new Error("openStream not used in executor settings tests");
    },
    async native() {
      return true;
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  };
}

const originalLocalStorage = (globalThis as any).localStorage;

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  applySettings({ ...DEFAULT_SETTINGS });
});

afterEach(() => {
  __setHostTransportForTest(undefined);
  applySettings({ ...DEFAULT_SETTINGS });
  (globalThis as any).localStorage = originalLocalStorage;
});

describe("executor settings", () => {
  test("rejects stale executor ids from persisted settings", () => {
    localStorage.setItem("oc_executor", "opencode");

    loadSettings();

    expect(settingsStore.executor).toBe("mirrorcode");
    expect(sanitizeExecutor("opencode")).toBe("mirrorcode");
  });

  test("task creation never sends a stale executor id", async () => {
    let captured: TransportRequest | undefined;
    __setHostTransportForTest(
      fakeTransport((req) => {
        captured = req;
        return {
          status: 200,
          ok: true,
          headers: {},
          body: { task_id: "task_123" },
        };
      }),
    );
    setSettingsStore("executor", "opencode" as any);

    await createTask({ text: "hello" });

    expect(captured?.body?.kind).toBe("json");
    expect((captured?.body as any).value.executor).toBe("mirrorcode");
  });

  test("panel request body sanitizes explicit executor input", () => {
    expect(panelRequestBody("hello", {}, "req_1", [], "opencode").executor).toBe("mirrorcode");
  });

  test("native settings task id alias restores the workspace task", () => {
    applySettings({
      ...DEFAULT_SETTINGS,
      workspaceTaskId: "tsk_native",
    } as Partial<typeof DEFAULT_SETTINGS> & { workspaceTaskId: string });

    expect(settingsStore.workspaceTaskID).toBe("tsk_native");
  });

  test("bootstrap settings writes the native workspace task id field", () => {
    setSettingsStore("workspaceTaskID", "tsk_saved");

    expect((bootstrapOverlaySettings(settingsStore) as any).workspaceTaskId).toBe("tsk_saved");
  });
});
