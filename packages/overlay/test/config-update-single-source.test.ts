import { afterEach, describe, expect, test } from "bun:test";
import { updateConfig } from "../src/services/config";
import { setAppStore, appStore } from "../src/store/app";
import {
  __setHostTransportForTest,
  type HostTransport,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport";

function fakeConfigTransport(calls: TransportRequest[]): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      calls.push(req);
      if (req.path !== "config") {
        throw new Error(`unexpected request ${req.path}`);
      }
      if (req.method === "GET") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: { model: "before", provider: {} } as T,
        };
      }
      if (req.method === "PATCH") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: req.body?.kind === "json" ? req.body.value as T : {} as T,
        };
      }
      throw new Error(`unexpected method ${req.method}`);
    },
    openStream() {
      throw new Error("openStream not used");
    },
    async native() {
      throw new Error("native not used");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  };
}

describe("updateConfig writes through the Solid config store", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined);
    setAppStore("config", null);
  });

  test("PATCH response becomes the local config mirror without a second config fetch", async () => {
    const calls: TransportRequest[] = [];
    __setHostTransportForTest(fakeConfigTransport(calls));
    setAppStore("config", { model: "stale" });

    const saved = await updateConfig((config) => {
      config.model = "after";
      config.provider.openai = { api: "https://api.openai.com/v1" };
    });

    expect(saved).toEqual(appStore.config);
    expect(appStore.config.model).toBe("after");
    expect(appStore.config.provider.openai.api).toBe("https://api.openai.com/v1");
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
  });
});
