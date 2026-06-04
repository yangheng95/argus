export * from "./client.js"
export * from "./server.js"

import {
  createOpenCorvusClient as createOpenCorvusClientImpl,
  createOpencodeClient as createOpencodeClientImpl,
  type OpenCorvusClientConfig,
  type OpencodeClientConfig,
  OpenCorvusClient,
  OpencodeClient,
} from "./client.js"
import {
  createOpenCorvusServer as createOpenCorvusServerImpl,
  createOpenCorvusTui as createOpenCorvusTuiImpl,
  createOpencodeServer as createOpencodeServerImpl,
  createOpencodeTui as createOpencodeTuiImpl,
  type ServerOptions,
  type TuiOptions,
} from "./server.js"

export type { OpenCorvusClientConfig, OpencodeClientConfig, ServerOptions, TuiOptions }
export { OpenCorvusClient, OpencodeClient }
export const createOpenCorvusClient = createOpenCorvusClientImpl
export const createOpencodeClient = createOpencodeClientImpl
export const createOpenCorvusServer = createOpenCorvusServerImpl
export const createOpenCorvusTui = createOpenCorvusTuiImpl
export const createOpencodeServer = createOpencodeServerImpl
export const createOpencodeTui = createOpencodeTuiImpl

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

export const createOpencode = createOpenCorvus
