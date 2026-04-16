// ── InteractionQuestionPart ──
// Renders a pending `type: "question"` interaction inline inside the
// conversation timeline as a system-role message. Submits / skips via the
// shared interaction-reply helper and triggers a board reload on success.

import { createSignal, createMemo, For, Show } from "solid-js";
import { t } from "../utils/i18n";
import { loadBoard } from "../store/board";
import { replyInteraction, rejectInteraction } from "../services/interaction-reply";

interface Question {
  header?: string;
  question?: string;
  multiple?: boolean;
  custom?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

interface Interaction {
  id: string;
  type: string;
  title?: string;
  status: string;
  payload?: { questions?: Question[] };
}

interface InteractionQuestionPartProps {
  interaction: Interaction;
}

export function InteractionQuestionPart(props: InteractionQuestionPartProps) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [drafts, setDrafts] = createSignal<string[][]>([]);
  const [customText, setCustomText] = createSignal<string[]>([]);

  const questions = createMemo<Question[]>(() => {
    const q = props.interaction?.payload?.questions;
    return Array.isArray(q) ? q : [];
  });

  function getSelected(qIdx: number): string[] {
    return drafts()[qIdx] ?? [];
  }

  function toggleOption(qIdx: number, label: string, multiple: boolean) {
    setDrafts((prev) => {
      const next = [...prev];
      const current = next[qIdx] ?? [];
      next[qIdx] = multiple
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : current.includes(label)
          ? []
          : [label];
      return next;
    });
  }

  function setCustomAt(qIdx: number, value: string) {
    setCustomText((prev) => {
      const next = [...prev];
      next[qIdx] = value;
      return next;
    });
  }

  async function submit() {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const answers = questions().map((_, idx) => {
        const picked = getSelected(idx);
        const custom = (customText()[idx] ?? "").trim();
        return custom ? [...picked, custom] : picked;
      });
      await replyInteraction(props.interaction.id, "answer", false, { answers });
      await loadBoard();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await rejectInteraction(props.interaction.id, false);
      await loadBoard();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="interaction-alert interaction-alert-inline" data-id={props.interaction.id}>
      <Show when={props.interaction.title}>
        <div class="interaction-title">
          {"\u2753"} {props.interaction.title}
        </div>
      </Show>
      <Show when={error()}>
        <div class="interaction-error">
          {t("interaction.error", { message: error() })}
        </div>
      </Show>
      <Show when={questions().length > 0}>
        <div class="interaction-questions">
          <For each={questions()}>
            {(q, qIdx) => {
              const multi = q.multiple === true;
              const allowCustom = q.custom !== false;
              const opts = Array.isArray(q.options) ? q.options : [];
              return (
                <div class="interaction-question">
                  <Show when={q.question}>
                    <div class="interaction-question-text">{q.question}</div>
                  </Show>
                  <Show when={opts.length > 0}>
                    <div class="interaction-options">
                      <For each={opts}>
                        {(opt) => (
                          <label class="interaction-option">
                            <input
                              type={multi ? "checkbox" : "radio"}
                              name={`iq-${props.interaction.id}-${qIdx()}`}
                              checked={getSelected(qIdx()).includes(opt.label)}
                              disabled={busy()}
                              onChange={() => toggleOption(qIdx(), opt.label, multi)}
                            />
                            <span class="interaction-option-label">{opt.label}</span>
                            <Show when={opt.description}>
                              <span class="interaction-option-desc">{opt.description}</span>
                            </Show>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={allowCustom}>
                    <textarea
                      class="interaction-custom-input"
                      placeholder={t("interaction.custom_placeholder")}
                      rows={opts.length > 0 ? 1 : 3}
                      disabled={busy()}
                      value={customText()[qIdx()] ?? ""}
                      onInput={(e) =>
                        setCustomAt(
                          qIdx(),
                          (e.currentTarget as HTMLTextAreaElement).value,
                        )
                      }
                    />
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <div class="interaction-actions">
        <button
          class="btn btn-primary"
          disabled={busy()}
          title={t("interaction.answer_title")}
          aria-label={t("interaction.answer_title")}
          onClick={submit}
        >
          {t("interaction.answer")}
        </button>
        <button
          class="btn btn-ghost"
          disabled={busy()}
          title={t("interaction.skip_title")}
          aria-label={t("interaction.skip_title")}
          onClick={skip}
        >
          {t("interaction.skip")}
        </button>
      </div>
    </div>
  );
}
