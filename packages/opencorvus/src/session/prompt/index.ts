import { clearRewindCursorForSession } from "@/engine/rewind"
import { PermissionNext } from "@/permission/next"
import { Instance } from "../../project/instance"
import { Session } from ".."
import { SessionCommand } from "../command-exec"
import { SessionLoop } from "../loop"
import { SessionShell } from "../shell-exec"
import { SessionContext } from "../context"
import { createUserMessage, resolvePromptParts as resolvePromptPartsImpl } from "./parts"
import { PromptInput as PromptInputSchema, type PromptInput as PromptInputType } from "./schema"
import { SessionPromptState } from "./state"

export namespace SessionPrompt {
  export const assertNotBusy = SessionPromptState.assertNotBusy
  export const cancel = (sessionID: string, directory?: string) => {
    return SessionPromptState.cancel(sessionID, directory)
  }
  export const isActive = SessionPromptState.isActive
  export const isActiveInAnyDirectory = SessionPromptState.isActiveInAnyDirectory
  export const waitForFinish = SessionPromptState.waitForFinish
  export const ownerActivity = SessionPromptState.activity

  export const {
    LoopInput,
    loop,
    resolveTools,
    createStructuredOutputTool,
    setSessionRuntimeContract,
    getSessionRuntimeContract,
    clearSessionRuntimeContract,
    validateSessionRuntimeContractForContinuation,
    agentKindRequiresRuntimeContract,
    setStepHook,
    withStepHook,
  } = SessionLoop
  export const { ShellInput, shell } = SessionShell
  export type ShellInput = SessionShell.ShellInput
  export const { CommandInput, command } = SessionCommand
  export type CommandInput = SessionCommand.CommandInput

  export const PromptInput = PromptInputSchema
  export type PromptInput = PromptInputType
  export const resolvePromptParts = resolvePromptPartsImpl

  type PromptRuntimeHooks = {
    beforeLoop?: () => void | Promise<void>
  }

  async function runPrompt(input: PromptInputType, hooks?: PromptRuntimeHooks) {
    const session = await Session.get(input.sessionID)
    await clearRewindCursorForSession(session.id)
    return SessionContext.provide(session, async () => {
      const message = await createUserMessage(input)
      await Session.touch(input.sessionID)

      const permissions: PermissionNext.Ruleset = []
      for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({
          permission: tool,
          action: enabled ? "allow" : "deny",
          pattern: "*",
        })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        await Session.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) {
        return message
      }

      const beforeLoop = hooks?.beforeLoop?.()
      if (beforeLoop) await beforeLoop
      return Instance.provide({
        directory: session.directory,
        fn: () => loop({ sessionID: input.sessionID }),
      })
    })
  }

  export const prompt = Object.assign(
    (input: PromptInputType, hooks?: PromptRuntimeHooks) => runPrompt(PromptInput.parse(input), hooks),
    {
      force: (input: PromptInputType, hooks?: PromptRuntimeHooks) => runPrompt(input, hooks),
      schema: PromptInput,
    },
  )
}
