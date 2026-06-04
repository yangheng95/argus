import type { TuiPluginApi } from "@opencorvus-ai/plugin/tui"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE } from "@/coding-assistant/session"
import { panelCapabilities } from "@/panel/capability"
import { Locale } from "@/util/locale"

const surface = "right-sidebar"

type TaskItem = ReturnType<TuiPluginApi["state"]["project"]["tasks"]>[number]
type CapabilityItem = ReturnType<typeof capabilities>[number]
type TaskAction = {
  title: string
  description: string
  run: () => void | Promise<void>
}

export function title(action: string) {
  return action.replaceAll("_", " ")
}

export function taskTitle(title: string) {
  return Locale.truncateMiddle(title, 28)
}

export function capabilities(kind?: "query" | "mutation") {
  const actions = panelCapabilities(surface).actions
  return kind ? actions.filter((item) => item.kind === kind) : actions
}

function taskParams(api: TuiPluginApi, item: TaskItem) {
  return {
    taskID: item.task.id,
    directory: item.task.directory ?? api.state.path.directory,
  }
}

function showError(api: TuiPluginApi, err: unknown) {
  api.ui.toast({
    variant: "error",
    message: err instanceof Error ? err.message : String(err),
  })
}

async function runTaskMutation(api: TuiPluginApi, title: string, task: TaskItem, run: () => Promise<unknown>) {
  try {
    await run()
    api.ui.toast({
      variant: "success",
      message: `${title} queued for ${taskTitle(task.task.title)}`,
    })
  } catch (err) {
    showError(api, err)
  }
}

async function rightSidebarSession(api: TuiPluginApi) {
  const directory = api.state.path.directory
  const listed = await api.client.coding.sessions.list({ directory, limit: 1 }, { throwOnError: true })
  const existing = listed.data.sessions[0]
  if (existing) return existing
  const created = await api.client.coding.session.create({ directory }, { throwOnError: true })
  return created.data.session
}

function taskActions(api: TuiPluginApi, item: TaskItem) {
  const handlers: Record<string, TaskAction> = {
    select_task: {
      title: "Select task",
      description: "Persist this task as the right sidebar focus.",
      run() {
        return runTaskMutation(api, "Select task", item, async () => {
          const session = await rightSidebarSession(api)
          return api.client.coding.session.selection.update(
            {
              sessionID: session.id,
              directory: api.state.path.directory,
              taskID: item.task.id,
            },
            { throwOnError: true },
          )
        })
      },
    },
    send_task_message: {
      title: "Send message",
      description: "Append an operator follow-up to the task.",
      run() {
        api.ui.dialog.replace(() =>
          api.ui.DialogPrompt({
            title: "Send Task Message",
            placeholder: "Message",
            onConfirm(value) {
              const text = value.trim()
              if (!text) return
              void runTaskMutation(api, "Message", item, () =>
                api.client.task.message(
                  {
                    ...taskParams(api, item),
                    text,
                    source: RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE,
                  },
                  { throwOnError: true },
                ),
              )
            },
          }),
        )
      },
    },
    retry_task: {
      title: "Retry task",
      description: "Queue a retry for this task.",
      run() {
        return runTaskMutation(api, "Retry", item, () =>
          api.client.task.retry(taskParams(api, item), { throwOnError: true }),
        )
      },
    },
    replan_task: {
      title: "Replan task",
      description: "Queue a fresh plan for this task.",
      run() {
        return runTaskMutation(api, "Replan", item, () =>
          api.client.task.replan(taskParams(api, item), { throwOnError: true }),
        )
      },
    },
    cancel_task: {
      title: "Cancel task",
      description: "Cancel this task.",
      run() {
        api.ui.dialog.replace(() =>
          api.ui.DialogConfirm({
            title: "Cancel Task",
            message: `Cancel ${taskTitle(item.task.title)}?`,
            onConfirm() {
              void runTaskMutation(api, "Cancel", item, () =>
                api.client.task.cancel(taskParams(api, item), { throwOnError: true }),
              )
            },
          }),
        )
      },
    },
  }
  return capabilities("mutation").flatMap((capability): Array<CapabilityItem & TaskAction> => {
    const action = handlers[capability.action]
    return action ? [{ ...capability, ...action }] : []
  })
}

export function showTask(api: TuiPluginApi, item: TaskItem) {
  const options = taskActions(api, item).map((action) => ({
    title: action.title,
    value: action.action,
    description: action.description,
    category: "Task Action",
  }))
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect({
      title: taskTitle(item.task.title),
      options,
      onSelect(selected) {
        const action = taskActions(api, item).find((item) => item.action === selected.value)
        void action?.run()
      },
    }),
  )
}

export function showTasks(api: TuiPluginApi) {
  const tasks = api.state.project.tasks()
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect({
      title: "Project Tasks",
      options: tasks.map((item) => ({
        title: taskTitle(item.task.title),
        value: item.task.id,
        description: `${item.task.status} · ${item.active_sessions.length} active agents · ${item.pending_interactions} interactions`,
        category: item.task.status,
      })),
      onSelect(selected) {
        const item = api.state.project.tasks().find((item) => item.task.id === selected.value)
        if (item) showTask(api, item)
      },
    }),
  )
}

export function show(api: TuiPluginApi) {
  const options = capabilities().map((item) => ({
    title: item.action,
    value: item.action,
    description: item.description,
    category: item.kind === "query" ? "Project Query" : "Agent Team Action",
  }))
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect({
      title: "Agent Team Tools",
      options,
      onSelect(item) {
        api.ui.toast({
          variant: "info",
          message: `${item.value} is available through the project-bound panel tool surface.`,
        })
      },
    }),
  )
}
