import { afterEach, describe, expect, test } from "bun:test";
import { updateConfig } from "../src/services/config";
import { setAppStore, appStore } from "../src/store/app";
import {
  __setHostTransportForTest,
  type HostTransport,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const base = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key];
    } else {
      base[key] = mergePatch(base[key], value);
    }
  }
  return base;
}

function fakeConfigTransport(calls: TransportRequest[]): HostTransport {
  let config: Record<string, unknown> = {
    model: "before",
    agent: { build: { model: "hexin/old-build" } },
    provider: {},
  };
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
          body: structuredClone(config) as T,
        };
      }
      if (req.method === "PATCH") {
        const patch = req.body?.kind === "json" ? req.body.value : {};
        config = mergePatch(config, patch) as Record<string, unknown>;
        return {
          status: 200,
          ok: true,
          headers: {},
          body: structuredClone(config) as T,
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
    expect(appStore.config.agent.build.model).toBe("hexin/old-build");
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
    expect(calls[1].body?.kind).toBe("json");
    expect(calls[1].body?.value).toEqual({
      model: "after",
      provider: {
        openai: { api: "https://api.openai.com/v1" },
      },
    });
    expect(calls[1].body?.value).not.toHaveProperty("agent");
  });
});
