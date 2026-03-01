export interface AudioAttachment {
  data: Buffer
  mime: string
  filename?: string
  size: number
  duration?: number
}

export interface BotAdapter {
  readonly platform: string
  start(): Promise<void>
  stop(): Promise<void>
  sendMessage(channel: string, thread: string, text: string): Promise<void>
  uploadImage(channel: string, thread: string, imageBuffer: Buffer, filename: string, title?: string): Promise<void>
  onMessage(handler: MessageHandler): void
}

export interface IncomingMessage {
  platform: string
  channel: string
  thread: string
  user: string
  text: string
  audio?: AudioAttachment
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>
