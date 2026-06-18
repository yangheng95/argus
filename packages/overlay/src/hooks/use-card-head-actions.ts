import { createSignal } from "solid-js"

import type { CardNode } from "../store/card-tree"
import { collectCardText } from "../utils/card-tree"
import { t } from "../utils/i18n"
import { showAppDialog } from "../services/app-dialog"
import { formatErrorDetails, notifyError } from "../services/notify"

export interface UseCardHeadActionsInput {
  node: () => CardNode
  onRewind?: (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => Promise<void>
  onAgentCancel?: (sessionID: string) => Promise<void>
  agentSessionID?: () => string | undefined
}

export interface UseCardHeadActionsOutput {
  state: {
    copied: () => boolean
    rewinding: () => boolean
    cancelling: () => boolean
  }
  caps: {
    canCopy: () => boolean
    canRewind: () => boolean
    canCancel: () => boolean
  }
  onCopy: (e: Event) => void
  onRewind: (e: Event) => void
  onAgentCancel: (e: Event) => void
  labels: {
    copy: () => string
    copied: () => string
    rewind: () => string
    rewindStep: () => string
    cancel: () => string
  }
}

function isStageCard(node: CardNode): boolean {
  return node.kind === "agent" || node.kind === "phase" || node.kind === "step"
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  return false
}

export function useCardHeadActions(input: UseCardHeadActionsInput): UseCardHeadActionsOutput {
  const [copied, setCopied] = createSignal(false)
  const [rewinding, setRewinding] = createSignal(false)
  const [cancelling, setCancelling] = createSignal(false)

  const canCopy = () => !!collectCardText(input.node())
  const canRewind = () => {
    const node = input.node()
    return !!input.onRewind && isStageCard(node) && typeof node.time === "number" && node.time > 0
  }
  const canCancel = () => input.node().status === "running" && !!input.onAgentCancel && !!input.agentSessionID?.()

  const onCopy = (event: Event) => {
    event.stopPropagation()
    void (async () => {
      const text = collectCardText(input.node())
      if (!text) return
      const ok = await writeClipboard(text)
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })()
  }

  const onRewind = (event: Event) => {
    event.stopPropagation()
    if (!input.onRewind || !canRewind() || rewinding()) return
    void (async () => {
      const choice = await showAppDialog({
        title: t("card.rewind_confirm.title"),
        message: t("card.rewind_confirm.message"),
        select: true,
        selectValue: "view",
        selectOptions: [
          { value: "view", label: t("card.rewind_confirm.audit_only") },
          { value: "worktree", label: t("card.rewind_confirm.with_worktree") },
        ],
        okLabel: t("card.rewind_confirm.apply"),
        cancel: true,
        cancelLabel: t("common.cancel"),
      })
      if (!choice.confirmed || !choice.value) return
      setRewinding(true)
      try {
        const node = input.node()
        await input.onRewind!(node.time, node.id, {
          resetWorktree: choice.value === "worktree",
        })
      } catch (error) {
        notifyError({
          id: `card-rewind:${input.node().id}`,
          title: t("card.rewind_failed_title"),
          message: t("card.rewind_failed_message"),
          details: formatErrorDetails(error),
        })
      } finally {
        setTimeout(() => setRewinding(false), 800)
      }
    })()
  }

  const onAgentCancel = (event: Event) => {
    event.stopPropagation()
    const sessionID = input.agentSessionID?.()
    if (!sessionID || !input.onAgentCancel || cancelling()) return
    void (async () => {
      setCancelling(true)
      try {
        await input.onAgentCancel!(sessionID)
      } finally {
        setTimeout(() => setCancelling(false), 800)
      }
    })()
  }

  return {
    state: {
      copied,
      rewinding,
      cancelling,
    },
    caps: {
      canCopy,
      canRewind,
      canCancel,
    },
    onCopy,
    onRewind,
    onAgentCancel,
    labels: {
      copy: () => t("common.copy"),
      copied: () => t("common.copied"),
      rewind: () => t("card.rewind"),
      rewindStep: () => t("card.rewind_step"),
      cancel: () => t("card.agent_cancel"),
    },
  }
}
