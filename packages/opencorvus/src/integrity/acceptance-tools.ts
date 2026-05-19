import { createDeliveryTools, type DeliveryToolContext } from "@/delivery/tools"

/**
 * Integrity acceptance tools are the retired delivery verifier's evidence
 * tools, scoped to the integrity session. File mutation and nested integrity
 * review are intentionally excluded: post-build integrity is a reviewer, not a
 * final repair agent and not a recursive gate.
 */
export function createIntegrityAcceptanceTools(input?: DeliveryToolContext) {
  const tools = createDeliveryTools(input)
  const {
    edit_file: _editFile,
    write_file: _writeFile,
    run_integrity_review: _runIntegrityReview,
    ...reviewTools
  } = tools
  return reviewTools
}
