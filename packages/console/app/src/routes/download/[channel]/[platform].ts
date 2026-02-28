import type { APIEvent } from "@solidjs/start"
import type { DownloadPlatform } from "../types"

const assetNames: Record<string, string> = {
  "darwin-aarch64-dmg": "argus-desktop-darwin-aarch64.dmg",
  "darwin-x64-dmg": "argus-desktop-darwin-x64.dmg",
  "windows-x64-nsis": "argus-desktop-windows-x64.exe",
  "linux-x64-deb": "argus-desktop-linux-amd64.deb",
  "linux-x64-appimage": "argus-desktop-linux-amd64.AppImage",
  "linux-x64-rpm": "argus-desktop-linux-x86_64.rpm",
} satisfies Record<DownloadPlatform, string>

// Doing this on the server lets us preserve the original name for platforms we don't care to rename for
const downloadNames: Record<string, string> = {
  "darwin-aarch64-dmg": "Argus Desktop.dmg",
  "darwin-x64-dmg": "Argus Desktop.dmg",
  "windows-x64-nsis": "Argus Desktop Installer.exe",
} satisfies { [K in DownloadPlatform]?: string }

export async function GET({ params: { platform, channel } }: APIEvent) {
  const assetName = assetNames[platform]
  if (!assetName) return new Response(null, { status: 404 })

  const resp = await fetch(
    `https://github.com/anomalyco/${channel === "stable" ? "argus" : "argus-beta"}/releases/latest/download/${assetName}`,
    {
      cf: {
        // in case gh releases has rate limits
        cacheTtl: 60 * 5,
        cacheEverything: true,
      },
    } as any,
  )

  const downloadName = downloadNames[platform]

  const headers = new Headers(resp.headers)
  if (downloadName) headers.set("content-disposition", `attachment; filename="${downloadName}"`)

  return new Response(resp.body, { ...resp, headers })
}
