(function initOverlayWorkspace(global) {
  function createOverlayWorkspace(deps) {
    const state = deps.state;
    const dom = deps.dom;

    function setWorkspaceDirectory(value, source = "manual") {
      const next = typeof value === "string" ? value.trim() : "";
      state.directory = next;
      state.directoryMode = next ? "custom" : "temp";
      state.workspaceDirectorySource = source;
      if (typeof deps.onDirectoryChange === "function") deps.onDirectoryChange(next, source);
      return next;
    }

    function restoreWorkspaceDirectory() {
      if (state.directory) return state.directory;
      const next = typeof state.path?.directory === "string" ? state.path.directory.trim() : "";
      if (!next) return state.directory;
      return setWorkspaceDirectory(next, "auto");
    }

    function workspaceMode() {
      if (!state.connected) return "offline";
      if (state.selectedTaskID && state.chatSessionID) return "task-session";
      if (state.selectedTaskID) return "task";
      if (state.chatSessionID) return "session";
      return "empty";
    }

    function renderWorkspaceState() {
      if (deps.document?.body) {
        deps.document.body.dataset.workspace = workspaceMode();
      }
    }

    function hasWorkspaceSelection() {
      return !!(state.selectedTaskID || state.chatSessionID || state.managedSession?.id);
    }

    function clearWorkspaceRuntime() {
      deps.stopPolling();
      deps.stopSSE();
      if (state.boardKick) clearTimeout(state.boardKick);
      if (state.sessionKick) clearTimeout(state.sessionKick);
      state.boardKick = null;
      state.sessionKick = null;
      state.boardLoading = null;
      state.boardQueued = false;
      state.sessionLoading = null;
      state.sessionQueued = false;
      state.board = null;
      state.boardEtag = "";
      state.boardUpdatedAt = 0;
      state.sessionUpdatedAt = 0;
      state.session = [];
      renderWorkspaceState();
    }

    function clearProjectScopeData() {
      state.tasks = [];
      state.globalTasks = [];
      state.sessions = [];
      state.path = null;
      state.vcs = null;
      state.memoryFiles = [];
      state.memorySearchMode = false;
      state.preferences = [];
    }

    function enterEmptyWorkspace(options = {}) {
      if (options.globalView !== undefined) state.globalView = !!options.globalView;
      state.selectedTaskID = "";
      state.chatSessionID = "";
      state.managedSession = null;
      if (options.restoreDirectory !== false) restoreWorkspaceDirectory();
      clearWorkspaceRuntime();
      deps.renderManagedSessionList();
    }

    function enterTaskWorkspace(taskID, options = {}) {
      if (typeof options.directory === "string" && options.directory.trim()) {
        setWorkspaceDirectory(options.directory, "task");
      }
      state.selectedTaskID = taskID || "";
      state.chatSessionID = options.sessionID || "";
      state.managedSession = options.managedSession || null;
      clearWorkspaceRuntime();
      deps.renderManagedSessionList();
    }

    function enterSessionWorkspace(sessionID, options = {}) {
      if (typeof options.directory === "string" && options.directory.trim()) {
        setWorkspaceDirectory(options.directory, "session");
      }
      state.selectedTaskID = "";
      state.chatSessionID = sessionID || "";
      state.managedSession = options.managedSession || null;
      clearWorkspaceRuntime();
      deps.renderManagedSessionList();
    }

    return {
      workspaceMode,
      renderWorkspaceState,
      hasWorkspaceSelection,
      setWorkspaceDirectory,
      restoreWorkspaceDirectory,
      clearWorkspaceRuntime,
      clearProjectScopeData,
      enterEmptyWorkspace,
      enterTaskWorkspace,
      enterSessionWorkspace,
    };
  }

  global.createOverlayWorkspace = createOverlayWorkspace;
})(window);
