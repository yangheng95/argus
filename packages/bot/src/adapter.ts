export interface BotAdapter {
  readonly platform: string
  start(): Promise<void>
  stop(): Promise<void>
  sendMessage(channel: string, thread: string, text: string): Promise<void>
  onMessage(handler: MessageHandler): void
}

export interface IncomingMessage {
  platform: string
  channel: string
  thread: string
  user: string
  text: string
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>
