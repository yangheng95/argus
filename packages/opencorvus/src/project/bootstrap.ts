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
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { CronService } from "../scheduler/cron-service"
import { EventService } from "../scheduler/event-service"
import { TaskQueueService } from "../scheduler/task-queue-service"
import { OrchestratorService } from "@/orchestrator/service"
import { ChannelSupervisor } from "@/channel/supervisor"
import { Config } from "@/config/config"
import { OrchestratorEventLog } from "@/orchestrator/event-log"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()
  CronService.init()
  EventService.init()
  TaskQueueService.init()
  OrchestratorService.init()
  await ChannelSupervisor.sync(await Config.get()).catch((error) => {
    Log.Default.warn("channel supervisor init failed", { error: String(error) })
  })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
  OrchestratorEventLog.init()
}
