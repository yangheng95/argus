export * from "./client.js"
export * from "./server.js"

import {
  createOpenCorvusClient as createOpenCorvusClientImpl,
  type OpenCorvusClientConfig,
  OpenCorvusClient,
} from "./client.js"
import { createOpenCorvusServer as createOpenCorvusServerImpl, type ServerOptions } from "./server.js"

export type { OpenCorvusClientConfig, ServerOptions }
export { OpenCorvusClient }
export const createOpenCorvusClient = createOpenCorvusClientImpl
export const createOpenCorvusServer = createOpenCorvusServerImpl

export async function createOpenCorvus(options?: ServerOptions) {
  const server = await createOpenCorvusServerImpl({
    ...options,
  })

  const client = createOpenCorvusClientImpl({
    baseUrl: server.url,
    username: process.env.OPENCORVUS_SERVER_USERNAME,
    password: process.env.OPENCORVUS_SERVER_PASSWORD,
  })

  return {
    client,
    server,
  }
}
