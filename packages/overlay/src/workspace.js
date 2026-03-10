(function initOverlayWorkspace(global) {
  function createOverlayWorkspace(deps) {
    const state = deps.state;
    const dom = deps.dom;

    function workspaceMode() {
      if (!state.connected) return "offline";
      if (state.globalView) return "global";
      if (state.selectedTaskID && state.chatSessionID) return "task-session";
      if (state.selectedTaskID) return "task";
      if (state.chatSessionID) return "session";
      return "empty";
    }

    function renderWorkspaceState() {
      if (deps.document?.body) {
        deps.document.body.dataset.workspace = workspaceMode();
      }
      if (dom.btnGlobalView) {
        dom.btnGlobalView.dataset.active = state.globalView ? "true" : "false";
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
    }

    function enterEmptyWorkspace(options = {}) {
      state.selectedTaskID = "";
      state.chatSessionID = "";
      state.managedSession = null;
      if (typeof options.globalView === "boolean") {
        state.globalView = options.globalView;
      }
      clearWorkspaceRuntime();
      deps.renderManagedSessionList();
    }

    function enterTaskWorkspace(taskID, options = {}) {
      state.selectedTaskID = taskID || "";
      state.chatSessionID = options.sessionID || "";
      state.managedSession = options.managedSession || null;
      state.globalView = false;
      clearWorkspaceRuntime();
      deps.renderManagedSessionList();
    }

    function enterSessionWorkspace(sessionID, options = {}) {
      state.selectedTaskID = "";
      state.chatSessionID = sessionID || "";
      state.managedSession = options.managedSession || null;
      state.globalView = false;
      clearWorkspaceRuntime();
      deps.renderManagedSessionList();
    }

    return {
      workspaceMode,
      renderWorkspaceState,
      hasWorkspaceSelection,
      clearWorkspaceRuntime,
      clearProjectScopeData,
      enterEmptyWorkspace,
      enterTaskWorkspace,
      enterSessionWorkspace,
    };
  }

  global.createOverlayWorkspace = createOverlayWorkspace;
})(window);
