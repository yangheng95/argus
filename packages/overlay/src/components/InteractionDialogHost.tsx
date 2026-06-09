// ── InteractionDialogHost ──
// Pops the oldest pending permission/question interaction into a modal so the
// user never has to hunt for the answer surface inside the conversation
// timeline or workflow sidebar. The inline <InteractionCard> still renders in
// both surfaces as the persistent record; replies funnel through the same
// services/interaction-reply mutex, so submitting in either surface is safe.
//
// Behavior:
//   • Reactively reads boardStore.board.interactions, picks the oldest pending
//     interaction not already dismissed for this overlay session.
//   • Reuses <InteractionCard> for the body — there is exactly one place that
//     renders an interaction (rule 8 / rule 9). The card already closes the
//     loop with loadBoard() after a successful reply, which collapses the
//     dialog automatically once status moves off "pending".
//   • Esc / backdrop click marks the current interaction id as dismissed for
//     the lifetime of the host (until status changes or a fresh id arrives),
//     letting the user fall back to the inline card without the popup
//     re-asserting itself for the same prompt.

import { createMemo, createSignal, Show } from "solid-js"
import { boardStore } from "../store/board"
import { t } from "../utils/i18n"
import { InteractionCard, type InteractionData } from "./InteractionCard"
import { Dialog } from "./primitives/Dialog"

export function pickDialogInteraction(
  interactions: InteractionData[] | null | undefined,
  dismissed: ReadonlySet<string>,
): InteractionData | null {
  if (!Array.isArray(interactions)) return null
  const pending = interactions.filter(
    (it) => it?.status === "pending" && (it.type === "permission" || it.type === "question"),
  )
  if (pending.length === 0) return null
  const sorted = [...pending].sort((a, b) => {
    const aT = Number((a as any)?.time?.created ?? 0)
    const bT = Number((b as any)?.time?.created ?? 0)
    return aT - bT
  })
  for (const it of sorted) {
    if (!dismissed.has(it.id)) return it
  }
  return null
}

export function InteractionDialogHost() {
  const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set())

  const current = createMemo<InteractionData | null>(() => {
    const list = (boardStore.board?.interactions || []) as InteractionData[]
    const it = pickDialogInteraction(list, dismissed())
    if (!it) return null
    const pruned = pruneDismissed(dismissed(), list)
    if (pruned !== dismissed()) setDismissed(pruned)
    return it
  })

  const titleText = () => {
    const it = current()
    if (!it) return ""
    if (it.title) return it.title
    return it.type === "permission" ? t("interaction.icon.permission") : t("interaction.icon.question")
  }

  return (
    <Dialog
      id="interactionDialog"
      open={current() !== null}
      backdropClose={true}
      title={<span>{titleText()}</span>}
      formClass="interaction-dialog-form"
      onClose={() => {
        const it = current()
        if (!it) return
        setDismissed((prev) => {
          const next = new Set(prev)
          next.add(it.id)
          return next
        })
      }}
    >
      {/* `keyed` so the card remounts when the queue advances from one
         pending interaction to the next — otherwise the card's local draft /
         busy state would leak from the answered prompt into the new one. */}
      <Show when={current()} keyed>
        {(it) => <InteractionCard interaction={it} />}
      </Show>
    </Dialog>
  )
}

function pruneDismissed(dismissed: ReadonlySet<string>, interactions: InteractionData[]): ReadonlySet<string> {
  if (dismissed.size === 0) return dismissed
  const stillPending = new Set<string>()
  for (const it of interactions) {
    if (it?.status === "pending" && dismissed.has(it.id)) stillPending.add(it.id)
  }
  if (stillPending.size === dismissed.size) return dismissed
  return stillPending
}
