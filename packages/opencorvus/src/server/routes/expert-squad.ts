import { ExpertSquadPackageManager } from "@/expert-squad/manager"
import { Instance } from "@/project/instance"
import { NamedError } from "@opencorvus-ai/util/error"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { namedErrorResponse } from "../error"

export const ExpertSquadPackageError = NamedError.create(
  "ExpertSquadPackageError",
  z.object({
    message: z.string(),
  }),
)

const ImportFolderInput = z
  .object({
    sourceDirectory: z.string().min(1),
    replace: z.boolean().default(false),
  })
  .strict()

const ImportFileInput = z
  .object({
    archiveBase64: z.string().min(1),
    filename: z.string().min(1).optional(),
    replace: z.boolean().default(false),
  })
  .strict()

const ExportInput = z
  .object({
    id: z.string().min(1),
  })
  .strict()

const ImportResult = z.object({
  id: z.string(),
  targetRoot: z.string(),
  replaced: z.boolean(),
})

const ExportResult = z.object({
  id: z.string(),
  filename: z.string(),
  archiveBase64: z.string(),
  fileCount: z.number().int().nonnegative(),
})

async function packageRoute<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ExpertSquadPackageError) throw error
    throw new ExpertSquadPackageError(
      {
        message: error instanceof Error ? error.message : String(error),
      },
      { cause: error },
    )
  }
}

export function ExpertSquadRoutes() {
  return new Hono()
    .post(
      "/import-folder",
      describeRoute({
        summary: "Import an expert squad folder",
        description:
          "Validate and install a local expert-squad package folder into the current project's .opencorvus expert-squads catalog.",
        operationId: "expertSquad.importFolder",
        responses: {
          200: {
            description: "Imported expert squad package",
            content: {
              "application/json": {
                schema: resolver(ImportResult),
              },
            },
          },
          400: namedErrorResponse("Expert squad package import rejected", "ExpertSquadPackageError"),
        },
      }),
      validator("json", ImportFolderInput),
      async (c) => {
        const input = c.req.valid("json")
        return c.json(
          await packageRoute(() =>
            ExpertSquadPackageManager.importDirectory({
              projectDirectory: Instance.directory,
              sourceDirectory: input.sourceDirectory,
              replace: input.replace,
            }),
          ),
        )
      },
    )
    .post(
      "/import-file",
      describeRoute({
        summary: "Import an expert squad ZIP archive",
        description:
          "Validate and install a dropped expert-squad ZIP archive into the current project's .opencorvus expert-squads catalog.",
        operationId: "expertSquad.importFile",
        responses: {
          200: {
            description: "Imported expert squad package",
            content: {
              "application/json": {
                schema: resolver(ImportResult),
              },
            },
          },
          400: namedErrorResponse("Expert squad package import rejected", "ExpertSquadPackageError"),
        },
      }),
      validator("json", ImportFileInput),
      async (c) => {
        const input = c.req.valid("json")
        return c.json(
          await packageRoute(() =>
            ExpertSquadPackageManager.importArchive({
              projectDirectory: Instance.directory,
              archiveBase64: input.archiveBase64,
              filename: input.filename,
              replace: input.replace,
            }),
          ),
        )
      },
    )
    .post(
      "/export",
      describeRoute({
        summary: "Export an expert squad ZIP archive",
        description:
          "Validate and pack a canonical expert-squad package from the current project's .opencorvus expert-squads catalog.",
        operationId: "expertSquad.export",
        responses: {
          200: {
            description: "Exported expert squad archive",
            content: {
              "application/json": {
                schema: resolver(ExportResult),
              },
            },
          },
          400: namedErrorResponse("Expert squad package export rejected", "ExpertSquadPackageError"),
        },
      }),
      validator("json", ExportInput),
      async (c) => {
        const input = c.req.valid("json")
        const exported = await packageRoute(() =>
          ExpertSquadPackageManager.exportArchive({
            projectDirectory: Instance.directory,
            id: input.id,
          }),
        )
        return c.json({
          id: exported.id,
          filename: exported.filename,
          archiveBase64: Buffer.from(exported.bytes).toString("base64"),
          fileCount: exported.fileCount,
        })
      },
    )
}
