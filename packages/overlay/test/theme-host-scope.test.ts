import { afterEach, describe, expect, test } from "bun:test";
import type { HostKind, HostTransport } from "../src/services/host-transport";
import { __setHostTransportForTest } from "../src/services/host-transport";
import { applyTheme } from "../src/services/theme";
import {
  sanitizeThemeForHost,
  themeOptionsForHost,
  themeOptionsForCurrentHost,
} from "../src/services/theme-registry";
import { applySettings, DEFAULT_SETTINGS, settingsStore } from "../src/store/settings";

function fakeTransport(kind: HostKind): HostTransport {
  return {
    kind,
    async request() {
      throw new Error("request not used in theme host-scope tests");
    },
    openStream() {
      throw new Error("openStream not used in theme host-scope tests");
    },
    async native() {
      throw new Error("native not used in theme host-scope tests");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  };
}

function installDocument(): () => void {
  const previousDocument = (globalThis as any).document;
  (globalThis as any).document = {
    documentElement: {
      dataset: {},
      style: { setProperty() {} },
    },
    body: { dataset: {} },
  };
  return () => {
    (globalThis as any).document = previousDocument;
  };
}

afterEach(() => {
  __setHostTransportForTest(undefined);
  applySettings({ ...DEFAULT_SETTINGS });
});

describe("host-scoped overlay themes", () => {
  test("Tauri and browser theme controls do not expose VS Code passthrough theme", () => {
    expect(themeOptionsForHost("tauri").map((theme) => theme.id)).toEqual(["dark", "light", "system"]);
    expect(themeOptionsForHost("browser").map((theme) => theme.id)).toEqual(["dark", "light", "system"]);
  });

  test("VS Code webview theme controls expose the host passthrough theme", () => {
    expect(themeOptionsForHost("vscode").map((theme) => theme.id)).toEqual(["vscode-dark", "light", "system"]);
  });

  test("current-host registry follows the transport singleton", () => {
    __setHostTransportForTest(fakeTransport("tauri"));
    expect(themeOptionsForCurrentHost().map((theme) => theme.id)).not.toContain("vscode-dark");

    __setHostTransportForTest(fakeTransport("vscode"));
    expect(themeOptionsForCurrentHost().map((theme) => theme.id)).toContain("vscode-dark");
  });

  test("persisted vscode-dark is not accepted in Tauri settings", () => {
    __setHostTransportForTest(fakeTransport("tauri"));
    applySettings({ ...DEFAULT_SETTINGS, theme: "vscode-dark" });

    expect(settingsStore.theme).toBe("light");
    expect(sanitizeThemeForHost("vscode-dark", "tauri")).toBe("light");
  });

  test("applyTheme keeps non-VS Code documents off vscode-dark", () => {
    const cleanupDocument = installDocument();
    __setHostTransportForTest(fakeTransport("browser"));
    try {
      applyTheme("vscode-dark");
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.body.dataset.theme).toBe("light");
    } finally {
      cleanupDocument();
    }
  });

  test("VS Code host can still apply vscode-dark", () => {
    const cleanupDocument = installDocument();
    __setHostTransportForTest(fakeTransport("vscode"));
    try {
      applyTheme("vscode-dark");
      expect(document.documentElement.dataset.theme).toBe("vscode-dark");
      expect(document.body.dataset.theme).toBe("vscode-dark");
    } finally {
      cleanupDocument();
    }
  });
});
