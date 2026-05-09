import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  connectTerminal,
  createTerminal,
  deleteTerminal,
  listTerminalProfiles,
  listTerminals,
  type TerminalInfo,
  type TerminalProfile,
  type TerminalSocket,
} from "../services/terminal";
import { settingsStore } from "../store/settings";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

interface WorkspaceTerminalProps {
  directory: string;
  launchProfileID?: string;
  launchNonce?: number;
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
  let handledLaunchNonce = 0;

  const [sessions, setSessions] = createSignal<TerminalSession[]>([]);
  const [activeID, setActiveID] = createSignal("");
  const [profiles, setProfiles] = createSignal<TerminalProfile[]>([]);
  const [defaultProfileID, setDefaultProfileID] = createSignal("");
  const [selectedProfileID, setSelectedProfileID] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [panelError, setPanelError] = createSignal("");

  const activeSession = () => sessions().find((session) => session.info.id === activeID()) ?? null;
  const selectedProfile = createMemo(() =>
    profiles().find((profile) => profile.id === selectedProfileID()) ?? null,
  );
  const profileLabel = (id: string) => profiles().find((profile) => profile.id === id)?.label ?? id;
  const activeMeta = () => {
    const session = activeSession();
    if (!session) return props.directory || "";
    const parts = [profileLabel(session.info.profileID), session.info.cwd, `process ${session.info.pid}`];
    return parts.filter(Boolean).join("  ");
  };

  onMount(() => {
    handledLaunchNonce = props.launchNonce ?? 0;
    openXterm();
    void reloadSessions(props.launchProfileID);
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
    void reloadSessions(props.launchProfileID);
  });

  createEffect(() => {
    const nonce = props.launchNonce ?? 0;
    const profileID = props.launchProfileID ?? "";
    if (!nonce || nonce === handledLaunchNonce) return;
    handledLaunchNonce = nonce;
    if (!profileID) {
      setPanelError(t("terminal.profile_required"));
      return;
    }
    void launchProfile(profileID);
  });

  createEffect(() => {
    const session = activeSession();
    closeSocket();
    clearTerminal();
    if (!session) return;
    connect(session);
  });

  createEffect(() => {
    settingsStore.theme;
    applyXtermTheme();
  });

  async function reloadSessions(launchProfileID?: string) {
    if (!props.directory) {
      setPanelError(t("terminal.select_directory"));
      return;
    }
    setLoading(true);
    setPanelError("");
    try {
      await reloadProfiles();
      if (launchProfileID) {
        await launchProfile(launchProfileID);
        return;
      }
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

  async function reloadProfiles() {
    const response = await listTerminalProfiles();
    const defaultProfile = response.profiles.find((profile) => profile.id === response.defaultProfileID);
    if (!defaultProfile) {
      throw new Error(t("terminal.default_profile_missing"));
    }
    setProfiles(response.profiles);
    setDefaultProfileID(response.defaultProfileID);
    setSelectedProfileID((current) =>
      response.profiles.some((profile) => profile.id === current) ? current : response.defaultProfileID,
    );
  }

  async function newTerminal(profileID = selectedProfileID()) {
    if (!props.directory) {
      setPanelError(t("terminal.select_directory"));
      return;
    }
    if (profiles().length === 0) {
      await reloadProfiles();
    }
    const profile = profiles().find((item) => item.id === profileID);
    if (!profile) {
      setPanelError(t("terminal.profile_required"));
      return;
    }
    const dimensions = fitDimensions();
    setLoading(true);
    setPanelError("");
    try {
      const info = await createTerminal({
        profileID: profile.id,
        cwd: props.directory,
        cols: dimensions.cols,
        rows: dimensions.rows,
        title: profile.label,
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

  async function launchProfile(profileID: string) {
    if (profiles().length === 0) {
      await reloadProfiles();
    }
    if (!profiles().some((profile) => profile.id === profileID)) {
      setPanelError(t("terminal.profile_required"));
      return;
    }
    setSelectedProfileID(profileID);
    await newTerminal(profileID);
  }

  async function handleProfileChange(value: string) {
    if (!profiles().some((profile) => profile.id === value)) {
      setPanelError(t("terminal.profile_required"));
      return;
    }
    setSelectedProfileID(value);
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
      theme: terminalTheme(),
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

  function cssColor(name: string): string {
    if (!hostEl) throw new Error("Terminal renderer is not ready");
    const value = getComputedStyle(hostEl).getPropertyValue(name).trim();
    if (!value) throw new Error(`Terminal theme token ${name} is not defined`);
    return value;
  }

  function terminalTheme() {
    return {
      background: cssColor("--workspace-terminal-canvas"),
      foreground: cssColor("--workspace-terminal-fg"),
      cursor: cssColor("--workspace-terminal-cursor"),
      selectionBackground: cssColor("--workspace-terminal-selection"),
      black: cssColor("--workspace-terminal-black"),
      blue: cssColor("--workspace-terminal-blue"),
      brightBlack: cssColor("--workspace-terminal-bright-black"),
      brightBlue: cssColor("--workspace-terminal-bright-blue"),
      brightCyan: cssColor("--workspace-terminal-bright-cyan"),
      brightGreen: cssColor("--workspace-terminal-bright-green"),
      brightMagenta: cssColor("--workspace-terminal-bright-magenta"),
      brightRed: cssColor("--workspace-terminal-bright-red"),
      brightWhite: cssColor("--workspace-terminal-bright-white"),
      brightYellow: cssColor("--workspace-terminal-bright-yellow"),
      cyan: cssColor("--workspace-terminal-cyan"),
      green: cssColor("--workspace-terminal-green"),
      magenta: cssColor("--workspace-terminal-magenta"),
      red: cssColor("--workspace-terminal-red"),
      white: cssColor("--workspace-terminal-white"),
      yellow: cssColor("--workspace-terminal-yellow"),
    };
  }

  function applyXtermTheme() {
    if (!term || !hostEl) return;
    try {
      term.options.theme = terminalTheme();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
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
        <label class="workspace-terminal-profile" title={t("terminal.profile")}>
          <Icon name="terminal" />
          <select
            aria-label={t("terminal.profile")}
            value={selectedProfileID()}
            disabled={loading() || profiles().length === 0}
            data-ui="workspace-terminal-profile"
            onChange={(event) => void handleProfileChange(event.currentTarget.value)}
          >
            <For each={profiles()}>
              {(profile) => (
                <option value={profile.id}>
                  {profile.label}{profile.id === defaultProfileID() ? ` ${t("terminal.default_profile_suffix")}` : ""}
                </option>
              )}
            </For>
          </select>
        </label>
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
