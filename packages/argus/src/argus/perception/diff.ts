import type { DiffResult } from "../monitor/types"

export namespace ScreenDiff {
  export interface ImageData {
    rawBuffer: Buffer
    width: number
    height: number
    timestamp: number
  }

  export async function compare(
    previous: ImageData,
    current: ImageData,
    options?: { threshold?: number; diffThreshold?: number },
  ): Promise<DiffResult> {
    const pixelmatch = (await import("pixelmatch")).default

    // Different dimensions → 100% change
    if (previous.width !== current.width || previous.height !== current.height) {
      const totalPixels = Math.max(
        previous.width * previous.height,
        current.width * current.height,
      )
      return {
        changed: true,
        diffPixels: totalPixels,
        diffPercent: 100,
        totalPixels,
        previousTimestamp: previous.timestamp,
        currentTimestamp: current.timestamp,
      }
    }

    const totalPixels = current.width * current.height
    const diffPixels = pixelmatch(
      previous.rawBuffer,
      current.rawBuffer,
      undefined,
      current.width,
      current.height,
      { threshold: options?.threshold ?? 0.1 },
    )

    const diffPercent = (diffPixels / totalPixels) * 100
    const diffThreshold = options?.diffThreshold ?? 1

    return {
      changed: diffPercent > diffThreshold,
      diffPixels,
      diffPercent,
      totalPixels,
      previousTimestamp: previous.timestamp,
      currentTimestamp: current.timestamp,
    }
  }
}
