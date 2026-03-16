import type { Config } from "../config"

export type Adapter<T extends Config = Config> = {
  create(from: T, branch?: string | null): Promise<{ config: T; init: () => Promise<void> }>
  remove(from: T): Promise<void>
  request(from: T, method: string, url: string, data?: BodyInit, signal?: AbortSignal): Promise<Response | undefined>
}
