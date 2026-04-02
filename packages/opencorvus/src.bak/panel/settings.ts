import z from "zod"
import { Storage } from "@/storage/storage"
import { Session } from "@/session"

export namespace PanelSettings {
  export const Info = z.object({
    executor: z.string().optional(),
    alwaysOnTop: z.boolean().optional(),
    unattended: z.boolean().optional(),
    autoPermission: z.boolean().optional(),
    autoQuestion: z.boolean().optional(),
    sidebarCollapsed: z.boolean().optional(),
    sidebarWidth: z.number().nullable().optional(),
    sectionsWidth: z.number().nullable().optional(),
    opacity: z.number().optional(),
    zoom: z.number().optional(),
    theme: z.string().optional(),
    locale: z.string().optional(),
    directory: z.string().optional(),
  }).meta({ ref: "PanelSessionSettings" })

  export const Update = Info.partial()
    .extend({
      sidebarWidth: z.number().nullable().optional(),
      sectionsWidth: z.number().nullable().optional(),
    })
    .meta({ ref: "PanelSessionSettingsUpdate" })

  const key = (sessionID: string) => ["panel_settings", "session", sessionID]

  export async function get(sessionID: string) {
    await Session.get(sessionID)
    return Storage.read<z.infer<typeof Info>>(key(sessionID)).catch(() => ({}))
      .then((item) => Info.parse(item))
  }

  export async function set(sessionID: string, input: z.input<typeof Update>) {
    await Session.get(sessionID)
    const next = Update.parse(input)
    const current = await get(sessionID)
    const merged = Info.parse({
      ...current,
      ...next,
    })
    await Storage.write(key(sessionID), merged)
    return merged
  }
}
