(function initOverlayWorkspace(global) {
  function createOverlayWorkspace(deps) {
    const state = deps.state;
    const dom = deps.dom;

    function setWorkspaceDirectory(value, source = "manual") {
      const next = typeof value === "string" ? value.trim() : "";
      state.directory = next;
      if (source === "manual") {
        state.savedDirectory = next;
        if (next) state.tempDirectory = "";
        state.directoryMode = next ? "custom" : "temp";
      }
      state.workspaceDirectorySource = source;
      if (typeof deps.renderMeta === "function") deps.renderMeta();
      if (source === "manual" && typeof deps.onDirectoryChange === "function") deps.onDirectoryChange(next, source);
      return next;
    }

    function restoreWorkspaceDirectory() {
      const next =
        typeof state.savedDirectory === "string" && state.savedDirectory.trim()
          ? state.savedDirectory.trim()
          : typeof state.tempDirectory === "string" && state.tempDirectory.trim()
            ? state.tempDirectory.trim()
            : "";
      if (!next) return state.directory;
      state.directory = next;
      state.workspaceDirectorySource = "auto";
      state.directoryMode = state.savedDirectory ? "custom" : "temp";
      if (typeof deps.renderMeta === "function") deps.renderMeta();
      return next;
    }

    function workspaceMode() {
      if (!state.connected) return "offline";
      if (state.selectedTaskID) return "task";
      return "empty";
    }

    function renderWorkspaceState() {
      if (deps.document?.body) {
        deps.document.body.dataset.workspace = workspaceMode();
      }
      if (typeof deps.renderChatComposer === "function") deps.renderChatComposer();
    }

    function hasWorkspaceSelection() {
      return !!state.selectedTaskID;
    }

    function clearWorkspaceRuntime() {
      state.workspaceEpoch = (state.workspaceEpoch || 0) + 1;
      deps.stopPolling();
      deps.stopSSE();
      if (typeof deps.stopEventStream === "function") deps.stopEventStream();
      if (typeof deps.stopChatRequest === "function") void deps.stopChatRequest();
      if (state.boardKick) clearTimeout(state.boardKick);
      if (state.tasksKick) clearTimeout(state.tasksKick);
      if (state.conversationKick) clearTimeout(state.conversationKick);
      state.boardKick = null;
      state.tasksKick = null;
      state.conversationKick = null;
      state.boardLoading = null;
      state.boardQueued = false;
      state.conversationLoading = null;
      state.conversationQueued = false;
      state.tasksSeq = (state.tasksSeq || 0) + 1;
      state.board = null;
      state.boardEtag = "";
      state.boardUpdatedAt = 0;
      state.executorEvents = [];
      state.executorRunID = "";
      state.executorEventsFetchedAt = 0;
      state.conversationUpdatedAt = 0;
      state.messages = [];
      state.pendingTaskMessages = null;
      renderWorkspaceState();
    }

    function clearProjectScopeData() {
      state.tasks = [];
      state.globalTasks = [];
      state.path = null;
      state.vcs = null;
      state.memoryFiles = [];
      state.memorySearchMode = false;
      state.preferences = [];
    }

    function enterEmptyWorkspace(options = {}) {
      if (options.globalView !== undefined) state.globalView = !!options.globalView;
      state.selectedTaskID = "";
      if (options.restoreDirectory !== false) restoreWorkspaceDirectory();
      clearWorkspaceRuntime();
      if (typeof deps.renderMeta === "function") deps.renderMeta();
      deps.renderTaskList();
    }

    function enterTaskWorkspace(taskID, options = {}) {
      if (typeof options.directory === "string" && options.directory.trim()) {
        setWorkspaceDirectory(options.directory, "task");
      }
      state.selectedTaskID = taskID || "";
      clearWorkspaceRuntime();
      if (typeof deps.renderMeta === "function") deps.renderMeta();
      deps.renderTaskList();
    }

    function enterSessionWorkspace(sessionID, options = {}) {
      throw new Error("Overlay no longer supports session workspaces; use tasks instead.");
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
