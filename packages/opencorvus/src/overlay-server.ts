import { installProcessShims } from "@/runtime/shims"

installProcessShims()

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import type { CommandModule } from "yargs"
import { Log } from "./util/log"
import { Installation } from "./installation"
import { NamedError } from "@opencorvus-ai/util/error"
import { FormatError } from "./cli/error"
import { EOL } from "os"
import { installProcessErrorLogging } from "./util/process-error-logging"

installProcessErrorLogging()

const argv = hideBin(process.argv)
const requestedCommand = argv.find((arg) => !arg.startsWith("-"))
const commands: CommandModule<any, any>[] =
  requestedCommand === "mcp"
    ? [(await import("./cli/cmd/mcp")).McpCommand]
    : [(await import("./cli/cmd/serve")).DefaultServeCommand, (await import("./cli/cmd/serve")).ServeCommand]

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("opencorvus")
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    Log.Default.info("opencorvus.overlay_server", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
for (const command of commands) {
  cli.command(command)
}

cli
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parseAsync()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) process.stderr.write(formatted + EOL)
  if (formatted === undefined) {
    process.stderr.write("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    process.stderr.write((e instanceof Error ? e.message : String(e)) + EOL)
  }
  process.exitCode = 1
}
