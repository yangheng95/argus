export interface FailureAnalysis {
  classification: string
  summary: string
  rootCause: string
  suggestedStrategy: string
  avoidApproaches: string[]
}

export interface PreviousGoalStatus {
  description: string
  status: string
  evidence: string
  requirement_ids?: string[]
}
