import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  connectTerminal,
  createTerminal,
  deleteTerminal,
  listTerminals,
  type TerminalInfo,
  type TerminalSocket,
} from "../services/terminal";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

interface WorkspaceTerminalProps {
  directory: string;
}

interface TerminalSession {
  info: TerminalInfo;
  cursor: number;
  connected: boolean;
  error: string;
  exited: boolean;
}

export function WorkspaceTerminal(props: WorkspaceTerminalProps) {
  let hostEl: HTMLDivElement | undefined;
  let term: XtermTerminal | undefined;
  let fitAddon: FitAddon | undefined;
  let socket: TerminalSocket | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let outputQueue: string[] = [];
  let outputScheduled = false;
  let lastDirectory = "";

  const [sessions, setSessions] = createSignal<TerminalSession[]>([]);
  const [activeID, setActiveID] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [panelError, setPanelError] = createSignal("");

  const activeSession = () => sessions().find((session) => session.info.id === activeID()) ?? null;
  const activeMeta = () => {
    const session = activeSession();
    if (!session) return props.directory || "";
    const parts = [session.info.cwd, `process ${session.info.pid}`];
    return parts.filter(Boolean).join("  ");
  };

  onMount(() => {
    openXterm();
    void reloadSessions();
  });

  onCleanup(() => {
    closeSocket();
    resizeObserver?.disconnect();
    term?.dispose();
  });

  createEffect(() => {
    const directory = props.directory;
    if (!lastDirectory) {
      lastDirectory = directory;
      return;
    }
    if (directory === lastDirectory) return;
    const previousSessions = sessions();
    closeSocket();
    setSessions([]);
    setActiveID("");
    clearTerminal();
    for (const session of previousSessions) {
      void deleteTerminal(session.info.id).catch((error) => {
        console.error("[terminal] failed to delete old-directory session", error);
      });
    }
    lastDirectory = directory;
    void reloadSessions();
  });

  createEffect(() => {
    const session = activeSession();
    closeSocket();
    clearTerminal();
    if (!session) return;
    connect(session);
  });

  async function reloadSessions() {
    if (!props.directory) {
      setPanelError(t("terminal.select_directory"));
      return;
    }
    setLoading(true);
    setPanelError("");
    try {
      const existing = (await listTerminals()).filter((item) => item.status === "running");
      if (existing.length > 0) {
        setSessions(existing.map((info) => ({
          info,
          cursor: info.cursor,
          connected: false,
          error: "",
          exited: false,
        })));
        setActiveID(existing[0].id);
        return;
      }
      await newTerminal();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function newTerminal() {
    if (!props.directory) {
      setPanelError(t("terminal.select_directory"));
      return;
    }
    const dimensions = fitDimensions();
    setLoading(true);
    setPanelError("");
    try {
      const info = await createTerminal({
        profileID: "default",
        cwd: props.directory,
        cols: dimensions.cols,
        rows: dimensions.rows,
        title: t("terminal.title"),
      });
      setSessions((items) => [
        ...items,
        { info, cursor: info.cursor, connected: false, error: "", exited: false },
      ]);
      setActiveID(info.id);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function closeTerminal(id: string) {
    const session = sessions().find((item) => item.info.id === id);
    if (!session) return;
    if (!window.confirm(t("terminal.close_confirm", { title: session.info.title }))) return;
    if (id === activeID()) closeSocket();
    await deleteTerminal(id).catch((error) => {
      setPanelError(error instanceof Error ? error.message : String(error));
    });
    const remaining = sessions().filter((item) => item.info.id !== id);
    setSessions(remaining);
    if (activeID() === id) setActiveID(remaining[0]?.info.id ?? "");
  }

  function connect(session: TerminalSession) {
    socket = connectTerminal(session.info.id, session.cursor, {
      onOpen() {
        updateSession(session.info.id, { connected: true, error: "" });
        sendResize();
      },
      onMessage(message) {
        if (message.type === "ready") {
          updateSession(message.info.id, { info: message.info, cursor: message.cursor });
          return;
        }
        if (message.type === "output") {
          enqueueOutput(message.data);
          updateSession(session.info.id, { cursor: message.cursor });
          return;
        }
        if (message.type === "history_truncated") {
          enqueueOutput(`\r\n[terminal history truncated before cursor ${message.oldestCursor}]\r\n`);
          return;
        }
        if (message.type === "exit") {
          enqueueOutput(`\r\n[terminal exited with code ${message.exitCode}]\r\n`);
          updateSession(session.info.id, { connected: false, exited: true });
          return;
        }
        updateSession(session.info.id, { error: message.message });
        enqueueOutput(`\r\n[terminal error] ${message.message}\r\n`);
      },
      onError(error) {
        updateSession(session.info.id, { error: error.message });
      },
      onClose() {
        updateSession(session.info.id, { connected: false });
      },
    });
  }

  function updateSession(id: string, patch: Partial<TerminalSession>) {
    setSessions((items) => items.map((item) => (item.info.id === id ? { ...item, ...patch } : item)));
  }

  function closeSocket() {
    try {
      socket?.close();
    } catch {
      // Socket close is best-effort during view switches.
    }
    socket = undefined;
  }

  function openXterm() {
    if (!hostEl) return;
    term = new XtermTerminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--mono)",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#101418",
        foreground: "#d7dde6",
        cursor: "#f8fafc",
        selectionBackground: "#2e425b",
        black: "#0b0f14",
        blue: "#6aa4ff",
        brightBlack: "#667085",
        brightBlue: "#8bb7ff",
        brightCyan: "#7dd3fc",
        brightGreen: "#8ee6a8",
        brightMagenta: "#d7a6ff",
        brightRed: "#ff9a9a",
        brightWhite: "#ffffff",
        brightYellow: "#f4d06f",
        cyan: "#67c7e6",
        green: "#70d690",
        magenta: "#c993ff",
        red: "#ff7b7b",
        white: "#d7dde6",
        yellow: "#e7bf4f",
      },
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(hostEl);
    term.onData((data) => {
      try {
        socket?.send({ type: "input", data });
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : String(error));
      }
    });
    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
      sendResize();
    });
    resizeObserver.observe(hostEl);
    fitAddon.fit();
  }

  function fitDimensions(): { cols: number; rows: number } {
    if (!fitAddon || !term) throw new Error("Terminal renderer is not ready");
    fitAddon.fit();
    return { cols: term.cols, rows: term.rows };
  }

  function sendResize() {
    if (!term || !socket) return;
    try {
      socket.send({ type: "resize", cols: term.cols, rows: term.rows });
    } catch {
      // The next ready/open event sends the current dimensions.
    }
  }

  function clearTerminal() {
    outputQueue = [];
    term?.reset();
  }

  function enqueueOutput(data: string) {
    outputQueue.push(data);
    if (outputScheduled) return;
    outputScheduled = true;
    requestAnimationFrame(() => {
      outputScheduled = false;
      const chunk = outputQueue.join("");
      outputQueue = [];
      term?.write(chunk);
    });
  }

  return (
    <section class="workspace-terminal">
      <header class="workspace-terminal-header">
        <div class="workspace-terminal-sessionbar">
          <div class="workspace-terminal-tabs" role="tablist" aria-label={t("terminal.sessions")}>
            <For each={sessions()}>
              {(session) => (
                <div
                  class="workspace-terminal-tab"
                  data-active={activeID() === session.info.id ? "true" : "false"}
                  data-connected={session.connected ? "true" : "false"}
                  data-exited={session.exited ? "true" : "false"}
                >
                  <button
                    type="button"
                    class="workspace-terminal-tab-main"
                    role="tab"
                    aria-selected={activeID() === session.info.id}
                    onClick={() => setActiveID(session.info.id)}
                  >
                    <span class="workspace-terminal-tab-status" aria-hidden="true" />
                    <span class="workspace-terminal-tab-title">{session.info.title}</span>
                  </button>
                  <button
                    type="button"
                    class="workspace-terminal-tab-close"
                    title={t("terminal.close")}
                    aria-label={t("terminal.close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTerminal(session.info.id);
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              )}
            </For>
          </div>
          <div class="workspace-terminal-meta" title={activeMeta()}>{activeMeta()}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tone="neutral"
          title={t("terminal.new")}
          onClick={() => void newTerminal()}
          disabled={loading()}
          data-ui="workspace-terminal-new"
        >
          <Icon name="terminal" />
        </Button>
      </header>
      <Show when={panelError()}>
        <div class="workspace-terminal-banner" data-kind="error">{panelError()}</div>
      </Show>
      <div class="workspace-terminal-body">
        <div class="workspace-terminal-viewport" ref={hostEl} />
      </div>
      <Show when={loading()}>
        <div class="workspace-terminal-loading">{t("common.loading")}</div>
      </Show>
    </section>
  );
}
