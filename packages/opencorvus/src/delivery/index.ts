/**
 * `delivery` agent — adversarial verification + verdict gate.
 *
 * Public surface:
 *   - DeliveryAgent.verify(input) → DeliveryVerdictType
 *   - DELIVERY_AGENT_SYSTEM (re-export of prompt/core/delivery-core.txt
 *     content) — kept for legacy consumers in agent/agent.ts.
 *   - createDeliveryTools / createDeliveryOutputTools — exposed for the
 *     orchestrator wiring layer.
 *
 * Note: `service.ts` still wraps DeliveryAgent.verify with error
 * normalization for backwards compatibility; that wrapper is removed in
 * phase-4 of the isomorphic-agent refactor (CLAUDE.md rule 22).
 */
export { DeliveryAgent, DELIVERY_AGENT_SYSTEM } from "./agent"
export type { DeliveryVerdictType } from "./verdict"
export {
  createDeliverySpecialistReview,
  findDeliverySpecialistReviews,
  persistDeliverySpecialistReview,
  requiredReviewersForSurfaces,
  validateDeliverySpecialistReview,
} from "./specialist-review"
export { runFrontendReview, runVisualRuntimeReview } from "./specialists/frontend-visual"
export { runTestIntegrationReview } from "./specialists/test-integration"
export type {
  DeliveryReviewFinding,
  DeliverySpecialistReview,
  DeliverySpecialistReviewer,
} from "./specialist-review"
