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
import { ProjectGC } from "./gc"
import { Truncate } from "../tool/truncation"
import { CronService } from "../scheduler/cron-service"
import { EventService } from "../scheduler/event-service"
import { TaskQueueService } from "../scheduler/task-queue-service"
import { EngineService } from "@/task-api"
import { ChannelSupervisor } from "@/channel/supervisor"
import { Config } from "@/config/config"
import { ensureTaskMessageProtocolBridge } from "@/orchestrator/protocol/message-bridge"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  ProjectGC.init()
  Truncate.init()
  CronService.init()
  EventService.init()
  TaskQueueService.init()
  EngineService.init()
  ensureTaskMessageProtocolBridge()
  await ChannelSupervisor.sync(await Config.get()).catch((error) => {
    Log.Default.warn("channel supervisor init failed", { error: String(error) })
  })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
