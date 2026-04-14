import type { Config } from "../config"

export type Adaptor<T extends Config = Config> = {
  create(from: T, branch?: string | null): Promise<{ config: T }>
  remove(from: T): Promise<void>
  request(from: T, method: string, url: string, data?: BodyInit, signal?: AbortSignal): Promise<Response | undefined>
}
