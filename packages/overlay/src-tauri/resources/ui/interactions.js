(function initOverlayInteractions(global) {
  function createOverlayInteractions(deps) {
    const state = deps.state;
    const dom = deps.dom;

    let busy = false;
    let pendingInteraction = null;
    const autoResolveFailed = new Map(); // interactionID → timestamp of last failure

    function interactionActions(interaction) {
      if (interaction.type === "permission") {
        return `<button class="btn btn-primary" data-action="always" title="${deps.escapeHtml(deps.t("interaction.always_allow_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.always_allow_title"))}">${deps.escapeHtml(deps.t("interaction.always_allow"))}</button>
         <button class="btn btn-ghost" data-action="once" title="${deps.escapeHtml(deps.t("interaction.allow_once_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.allow_once_title"))}">${deps.escapeHtml(deps.t("interaction.allow_once"))}</button>
         <button class="btn btn-ghost" data-action="reject" title="${deps.escapeHtml(deps.t("interaction.reject_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.reject_title"))}">${deps.escapeHtml(deps.t("interaction.reject"))}</button>`;
      }
      return `<button class="btn btn-primary" data-action="answer" title="${deps.escapeHtml(deps.t("interaction.answer_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.answer_title"))}">${deps.escapeHtml(deps.t("interaction.answer"))}</button>
         <button class="btn btn-ghost" data-action="reject" title="${deps.escapeHtml(deps.t("interaction.skip_title"))}" aria-label="${deps.escapeHtml(deps.t("interaction.skip_title"))}">${deps.escapeHtml(deps.t("interaction.skip"))}</button>`;
    }

    function interactionIcon(interaction) {
      return interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753";
    }

    function interactionAlertHtml(interaction) {
      return `<div class="interaction-alert" data-id="${deps.escapeHtml(interaction.id)}">
    <div class="interaction-title">${interactionIcon(interaction)} ${deps.escapeHtml(interaction.title)}</div>
    <div class="interaction-body md-content">${deps.renderMarkdown(interaction.body)}</div>
    <div class="interaction-actions">${interactionActions(interaction)}</div>
  </div>`;
    }

    function autoInteractionAnswers(interaction) {
      const payload = deps.record(interaction?.payload) ? interaction.payload : null;
      const questions = Array.isArray(payload?.questions) ? payload.questions : [];
      if (questions.length === 0) return null;
      return questions.map((item) => {
        const question = deps.record(item) ? item : null;
        const options = Array.isArray(question?.options) ? question.options : [];
        const selected = options.find((option) => deps.record(option) && typeof option.label === "string" && option.label.trim());
        if (selected && typeof selected.label === "string") return [selected.label.trim()];
        return null;
      });
    }

    function shouldAutoResolveInteraction(interaction) {
      if (!interaction || interaction.status !== "pending") return false;
      if (interaction.type === "permission") return state.autoPermission;
      if (interaction.type === "question") return state.autoQuestion || state.unattended;
      return false;
    }

    function bindInteractionActions(root) {
      root?.querySelectorAll?.(".interaction-alert [data-action]")?.forEach((btn) => {
        if (btn.dataset.bound === "true") return;
        btn.dataset.bound = "true";
        btn.addEventListener("click", () => {
          const alert = btn.closest(".interaction-alert");
          const id = alert?.dataset.id;
          if (!id) return;
          const action = btn.dataset.action;
          if (action === "reject") rejectInteraction(id);
          else resolveInteraction(id, action);
        });
      });
    }

    function dismissInteractionModal() {
      const modal = deps.document?.getElementById("interaction-modal");
      if (modal) modal.remove();
      pendingInteraction = null;
      void refreshInteractionAttention();
    }

    function showInteractionModal(interaction) {
      let modal = deps.document?.getElementById("interaction-modal");
      if (modal && modal.dataset.interactionId === interaction.id) return;
      dismissInteractionModal();
      pendingInteraction = interaction;
      const html = `<div id="interaction-modal" class="interaction-modal-overlay" data-interaction-id="${deps.escapeHtml(interaction.id)}">
    <div class="interaction-modal">
      <div class="interaction-modal-title">${interactionIcon(interaction)} ${deps.escapeHtml(interaction.title)}</div>
      <div class="interaction-modal-body md-content">${deps.renderMarkdown(interaction.body)}</div>
      <div class="interaction-modal-actions">${interactionActions(interaction)}</div>
    </div>
  </div>`;
      deps.document?.body?.insertAdjacentHTML("beforeend", html);
      modal = deps.document?.getElementById("interaction-modal");
      modal?.querySelectorAll("[data-action]")?.forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          if (action === "reject") rejectInteraction(interaction.id);
          else resolveInteraction(interaction.id, action);
        });
      });
      void refreshInteractionAttention();
    }

    function attentionActive() {
      if (!pendingInteraction) return false;
      if (!deps.document) return true;
      return deps.document.visibilityState === "hidden" || !deps.document.hasFocus();
    }

    async function refreshInteractionAttention() {
      await deps.setTrayAttention?.(attentionActive());
    }

    function disableInteractionButtons(id) {
      const alert = deps.document?.querySelector(`.interaction-alert[data-id="${id}"]`);
      alert?.querySelectorAll("button")?.forEach((btn) => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
      });
      const modal = deps.document?.querySelector(`#interaction-modal[data-interaction-id="${id}"]`);
      modal?.querySelectorAll("[data-action]")?.forEach((btn) => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
      });
      const title = alert?.querySelector(".interaction-title");
      if (title) title.textContent += deps.t("interaction.processing_suffix");
    }

    function showInteractionError(id, msg) {
      const alert = deps.document?.querySelector(`.interaction-alert[data-id="${id}"]`);
      const title = alert?.querySelector(".interaction-title");
      if (title) title.textContent = deps.t("interaction.error", { message: msg });
      alert?.querySelectorAll("button")?.forEach((btn) => {
        btn.disabled = false;
        btn.style.opacity = "";
      });
    }

    async function resolveInteraction(id, action, input = {}) {
      if (busy) return;
      busy = true;
      autoResolveFailed.delete(id);
      disableInteractionButtons(id);
      try {
        if (action === "once" || action === "always") {
          await deps.apiJson(`interaction/${id}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: action }),
            signal: AbortSignal.timeout(30000),
          });
          return;
        }

        const answers = Array.isArray(input.answers) ? input.answers : null;
        const message = typeof input.message === "string" && input.message.trim() ? input.message.trim() : "";
        if (!answers && !message) {
          const answer = await deps.nativePrompt(deps.t("interaction.reply_prompt"), {
            title: deps.t("interaction.reply_title"),
            okLabel: deps.t("common.submit"),
            cancelLabel: deps.t("common.cancel"),
            inputLabel: deps.t("interaction.answer_label"),
          });
          if (answer == null) return;
          await deps.apiJson(`interaction/${id}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: answer }),
            signal: AbortSignal.timeout(30000),
          });
          return;
        }

        await deps.apiJson(`interaction/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: answers || undefined,
            message: message || undefined,
          }),
          signal: AbortSignal.timeout(30000),
        });
      } catch (error) {
        deps.AppLog.error("ui", "Failed to resolve interaction", { error: String(error) });
        showInteractionError(id, error?.message || String(error));
        autoResolveFailed.set(id, Date.now());
      } finally {
        dismissInteractionModal();
        busy = false;
        await deps.loadBoard();
      }
    }

    async function rejectInteraction(id) {
      if (busy) return;
      busy = true;
      disableInteractionButtons(id);
      try {
        await deps.apiJson(`interaction/${id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(30000),
        });
      } catch (error) {
        deps.AppLog.error("ui", "Failed to reject interaction", { error: String(error) });
        showInteractionError(id, error?.message || String(error));
      } finally {
        dismissInteractionModal();
        busy = false;
        await deps.loadBoard();
      }
    }

    function isInteractionBusy() {
      return busy;
    }

    function renderInteractions(interactions) {
      const pending = Array.isArray(interactions) ? interactions.filter((item) => item.status === "pending") : [];
      const body = dom.goalsBody;

      body?.querySelectorAll(".interaction-alert")?.forEach((item) => item.remove());

      if (pending.length === 0) {
        dismissInteractionModal();
        return;
      }

      if (body) {
        body.insertAdjacentHTML("beforeend", pending.map(interactionAlertHtml).join(""));
        bindInteractionActions(body);
      }

      if (!busy && shouldAutoResolveInteraction(pending[0])) {
        const cooldownMs = 10000;
        const lastFail = autoResolveFailed.get(pending[0].id);
        if (lastFail && (Date.now() - lastFail) < cooldownMs) {
          pendingInteraction = pending[0];
          showInteractionModal(pending[0]);
          return;
        }
        dismissInteractionModal();
        if (pending[0].type === "permission") {
          void resolveInteraction(pending[0].id, state.autoPermissionReply === "always" ? "always" : "once");
          return;
        }
        const answers = autoInteractionAnswers(pending[0]);
        if (!answers || answers.some((item) => !Array.isArray(item) || item.length === 0)) {
          deps.AppLog.warn("ui", "Skipping automatic question reply due to missing structured options", {
            interactionID: pending[0].id,
          });
          pendingInteraction = pending[0];
          showInteractionModal(pending[0]);
          return;
        }
        void resolveInteraction(pending[0].id, "answer", {
          answers,
        });
        return;
      }

      if (!busy) {
        pendingInteraction = pending[0];
        showInteractionModal(pending[0]);
        return;
      }

      pendingInteraction = null;
      void refreshInteractionAttention();
    }

    return {
      interactionAlertHtml,
      renderInteractions,
      showInteractionModal,
      dismissInteractionModal,
      resolveInteraction,
      rejectInteraction,
      isInteractionBusy,
      refreshInteractionAttention,
    };
  }

  global.createOverlayInteractions = createOverlayInteractions;
})(window);
