export interface WorkerInput {
  title: string
  agent: string
  prompt: string
  sessionId?: string
}

export interface WorkerResult {
  sessionId: string
  messageId?: string
  text: string
}

export interface Worker {
  run(input: WorkerInput): Promise<WorkerResult>
}
