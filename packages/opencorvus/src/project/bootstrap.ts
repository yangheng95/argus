import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ProjectGC } from "./gc"
import { WorktreeGC } from "../worktree/gc"
import { Truncate } from "../tool/truncation"
import { CronService } from "../scheduler/cron-service"
import { EventService } from "../scheduler/event-service"
import { TaskQueueService } from "../scheduler/task-queue-service"
import { EngineService } from "@/task-api"
import { EngineEventLog } from "@/engine/event-log"
import { ChannelSupervisor } from "@/channel/supervisor"
import { Config } from "@/config/config"
import { ensureTaskMessageProtocolBridge } from "@/orchestrator/protocol/message-bridge"
import { TerminalProfile } from "@/system-terminal/profile"
import { ensureMissionCallerReceiptBridge } from "@/mission/caller-receipt"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  Format.init()
  await LSP.init()
  await FileWatcher.init()
  await File.init()
  Vcs.init()
  // Snapshot has no init/cleanup of its own — disk reclaim is ProjectGC's
  // sole responsibility (whole-project rm). See snapshot/index.ts.
  ProjectGC.init()
  // Phase F of specs/current/architecture/10-worktree-lifecycle.md — periodic sweep of
  // orphaned goal worktrees (age + clean + no in-transit commits + not live).
  WorktreeGC.init()
  Truncate.init()
  CronService.init()
  EventService.init()
  TaskQueueService.init()
  EngineService.init()
  EngineEventLog.init()
  ensureTaskMessageProtocolBridge()
  ensureMissionCallerReceiptBridge()
  await TerminalProfile.ensureProjectDefaultProfile()
  await ChannelSupervisor.sync(await Config.get()).catch((error) => {
    Log.Default.warn("channel supervisor init failed", { error: String(error) })
  })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
