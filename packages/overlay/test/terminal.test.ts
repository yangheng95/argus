import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { apiWebSocketUrl, configure } from "../src/services/api";
import { connectTerminal, parseServerMessage } from "../src/services/terminal";

const root = join(import.meta.dir, "..");

describe("terminal client", () => {
  test("apiWebSocketUrl carries server, auth, and directory context", () => {
    configure({
      serverUrl: "http://127.0.0.1:4099",
      username: "opencorvus",
      password: "secret",
      directory: "C:/work/project",
    });

    const url = new URL(apiWebSocketUrl("pty/pty_123/connect?cursor=7"));

    expect(url.protocol).toBe("ws:");
    expect(url.host).toBe("127.0.0.1:4099");
    expect(url.username).toBe("opencorvus");
    expect(url.password).toBe("secret");
    expect(url.searchParams.get("cursor")).toBe("7");
    expect(url.searchParams.get("directory")).toBe("C:/work/project");
  });

  test("parseServerMessage accepts typed terminal events and rejects malformed data", () => {
    const ready = parseServerMessage(JSON.stringify({
      type: "ready",
      cursor: 0,
      info: {
        id: "pty_123",
        profileID: "default",
        title: "Terminal",
        command: "cmd.exe",
        args: [],
        cwd: "C:/work/project",
        status: "running",
        pid: 42,
        cursor: 0,
      },
    }));

    expect(ready.ok).toBe(true);
    expect(parseServerMessage(JSON.stringify({ type: "output", cursor: 3, data: "abc" })).ok).toBe(true);
    expect(parseServerMessage("not-json").ok).toBe(false);
    expect(parseServerMessage(JSON.stringify({ type: "output", cursor: 3 })).ok).toBe(false);
  });

  test("connectTerminal queues client messages until the websocket opens", () => {
    const originalWebSocket = globalThis.WebSocket;
    const sent: string[] = [];
    const listeners = new Map<string, Array<(event: unknown) => void>>();

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      constructor(readonly url: string) {}
      addEventListener(type: string, listener: (event: unknown) => void) {
        const items = listeners.get(type) ?? [];
        items.push(listener);
        listeners.set(type, items);
      }
      send(data: string) {
        sent.push(data);
      }
      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }
      open() {
        this.readyState = FakeWebSocket.OPEN;
        for (const listener of listeners.get("open") ?? []) listener({});
      }
    }

    try {
      configure({ serverUrl: "http://127.0.0.1:4099", password: "", directory: "C:/work/project" });
      let socketInstance: FakeWebSocket | undefined;
      (globalThis as any).WebSocket = class extends FakeWebSocket {
        constructor(url: string) {
          super(url);
          socketInstance = this;
        }
      };
      (globalThis as any).WebSocket.CONNECTING = FakeWebSocket.CONNECTING;
      (globalThis as any).WebSocket.OPEN = FakeWebSocket.OPEN;
      (globalThis as any).WebSocket.CLOSED = FakeWebSocket.CLOSED;

      const socket = connectTerminal("pty_123", 0, { onMessage() {} });
      socket.send({ type: "input", data: "echo queued\r" });
      expect(sent).toEqual([]);

      socketInstance?.open();

      expect(sent).toEqual([JSON.stringify({ type: "input", data: "echo queued\r" })]);
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("WorkspaceTerminal uses xterm and does not spawn a local shell", () => {
    const component = readFileSync(join(root, "src/components/WorkspaceTerminal.tsx"), "utf8");
    const pkg = readFileSync(join(root, "package.json"), "utf8");

    expect(component).toContain("@xterm/xterm");
    expect(component).toContain("@xterm/addon-fit");
    expect(component).toContain("listTerminalProfiles");
    expect(component).toContain('data-ui="workspace-terminal-profile"');
    expect(component).not.toContain('profileID: "default"');
    expect(component).not.toContain("child_process");
    expect(component).not.toContain("__TAURI__");
    expect(pkg).toContain('"@xterm/xterm"');
    expect(pkg).toContain('"@xterm/addon-fit"');
  });
});
