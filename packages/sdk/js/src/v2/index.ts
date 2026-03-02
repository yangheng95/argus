export * from "./client.js"
export * from "./server.js"

import { createOpenCorvusClient } from "./client.js"
import { createOpenCorvusServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createOpenCorvus(options?: ServerOptions) {
  const server = await createOpenCorvusServer({
    ...options,
  })

  const client = createOpenCorvusClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

export const createOpencode = createOpenCorvus
