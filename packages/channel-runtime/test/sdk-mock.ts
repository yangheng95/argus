async function* emptyStream() {}

function createNoopClient() {
  return {
    auth: {
      set: async () => ({ data: {}, error: undefined }),
    },
    channel: {
      message: async () => ({
        data: {
          kind: "message" as const,
          message: "",
        },
        error: undefined,
      }),
    },
    event: {
      subscribe: async () => ({
        stream: emptyStream(),
      }),
    },
    permission: {
      reply: async () => ({ data: {}, error: undefined }),
    },
    session: {
      create: async () => ({ data: { id: "session_mock" }, error: undefined }),
      get: async () => ({ data: undefined, error: undefined }),
      message: async () => ({ data: { parts: [] }, error: undefined }),
      promptAsync: async () => ({ data: { taskID: "task_mock" }, error: undefined }),
    },
  }
}

function createNoopServer() {
  return {
    url: "http://127.0.0.1:0",
    close() {},
  }
}

function createNoopTui() {
  return {
    close() {},
  }
}

export class OpenCorvusClientMock {
  auth = createNoopClient().auth
  channel = createNoopClient().channel
  event = createNoopClient().event
  permission = createNoopClient().permission
  session = createNoopClient().session
}

export const OpencodeClientMock = OpenCorvusClientMock

export const sdkMock = {
  createOpenCorvus: async () => ({
    client: createNoopClient(),
    server: createNoopServer(),
  }),
  createOpencode: async () => ({
    client: createNoopClient(),
    server: createNoopServer(),
  }),
  createOpenCorvusClient: () => createNoopClient(),
  createOpencodeClient: () => createNoopClient(),
  createOpenCorvusServer: async () => createNoopServer(),
  createOpencodeServer: async () => createNoopServer(),
  createOpenCorvusTui: () => createNoopTui(),
  createOpencodeTui: () => createNoopTui(),
  OpenCorvusClient: OpenCorvusClientMock,
  OpencodeClient: OpencodeClientMock,
}
