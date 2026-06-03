import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { configure } from "../src/services/api";
import {
  __setHostTransportForTest,
  type HostTransport,
  type NativeCommand,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport";
import {
  clearNotifications,
  notificationStore,
} from "../src/services/notify";
import { DEFAULT_SETTINGS, applySettings } from "../src/store/settings";

function installTransport(input: {
  native?: (command: NativeCommand) => Promise<unknown> | unknown;
  request?: (request: TransportRequest) => Promise<unknown> | unknown;
}): void {
  const transport: HostTransport = {
    kind: "tauri",
    async request<T>(request: TransportRequest): Promise<TransportResponse<T>> {
      if (input.request) {
        const body = await input.request(request);
        return { status: 200, ok: true, headers: {}, body: body as T };
      }
      throw new Error("request not configured");
    },
    openStream() {
      throw new Error("openStream not used");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
    async native(command) {
      if (input.native) return input.native(command);
      throw new Error(`native ${command.kind} not configured`);
    },
  };
  __setHostTransportForTest(transport);
}

beforeEach(() => {
  clearNotifications();
  applySettings({ ...DEFAULT_SETTINGS, autoServer: true, serverUrl: "http://127.0.0.1:7878" });
  configure({ serverUrl: "http://127.0.0.1:7878", directory: "" });
});

afterEach(() => {
  clearNotifications();
  __setHostTransportForTest(undefined);
  applySettings({ ...DEFAULT_SETTINGS });
  configure({ serverUrl: DEFAULT_SETTINGS.serverUrl, directory: "" });
});

describe("managed server startup diagnostics", () => {
  test("localServerInfo surfaces native startup failure through the notification center", async () => {
    const { localServerInfo } = await import("../src/services/connection");
    installTransport({
      native(command) {
        if (command.kind === "server.info") {
          throw new Error("failed to spawn bundled opencorvus server\nsidecar log: C:\\logs\\sidecar.log");
        }
        return undefined;
      },
    });

    const info = await localServerInfo();

    expect(info).toBeNull();
    expect(notificationStore.items).toHaveLength(1);
    expect(notificationStore.items[0]?.id).toBe("system:managed-server");
    expect(notificationStore.items[0]?.tone).toBe("error");
    expect(notificationStore.items[0]?.details).toContain("failed to spawn bundled opencorvus server");
    expect(notificationStore.items[0]?.details).toContain("C:\\logs\\sidecar.log");
  });

  test("repeated managed-server failures update one persistent notification", async () => {
    const { localServerInfo } = await import("../src/services/connection");
    let attempt = 0;
    installTransport({
      native(command) {
        if (command.kind === "server.info") {
          attempt += 1;
          throw new Error(`spawn attempt ${attempt}`);
        }
        return undefined;
      },
    });

    await localServerInfo();
    await localServerInfo();

    expect(notificationStore.items).toHaveLength(1);
    expect(notificationStore.items[0]?.id).toBe("system:managed-server");
    expect(notificationStore.items[0]?.details).toContain("spawn attempt 2");
  });

  test("checkConnection includes managed sidecar log path when the health probe fails", async () => {
    const { checkConnection } = await import("../src/services/connection");
    installTransport({
      native(command) {
        if (command.kind === "server.info") {
          return {
            url: "http://127.0.0.1:7878",
            pid: 456,
            sidecarLogPath: "C:\\logs\\sidecar-health.log",
          };
        }
        return undefined;
      },
      request() {
        throw new Error("health refused");
      },
    });

    const ok = await checkConnection();

    expect(ok).toBe(false);
    expect(notificationStore.items).toHaveLength(1);
    expect(notificationStore.items[0]?.details).toContain("server pid: 456");
    expect(notificationStore.items[0]?.details).toContain("C:\\logs\\sidecar-health.log");
    expect(notificationStore.items[0]?.details).toContain("health refused");
  }, 10_000);
});
