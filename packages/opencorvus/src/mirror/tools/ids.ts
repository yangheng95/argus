import {
  WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS,
  WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS,
  WEBPAGE_EVIDENCE_TOOL_IDS,
  isWebpageEvidenceAcceptanceToolId,
  isWebpageEvidenceAnalysisToolId,
  isWebpageEvidenceToolId,
} from "@/webpage-evidence/tools/ids"

/** @deprecated Use WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS. */
export const MIRROR_ANALYSIS_TOOL_IDS = WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS
/** @deprecated Use WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS. */
export const MIRROR_ACCEPTANCE_TOOL_IDS = WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS
/** @deprecated Use WEBPAGE_EVIDENCE_TOOL_IDS. */
export const MIRROR_TOOL_IDS = WEBPAGE_EVIDENCE_TOOL_IDS

/** @deprecated Use WebpageEvidenceToolId. */
export type MirrorToolId = typeof WEBPAGE_EVIDENCE_TOOL_IDS[number]
/** @deprecated Use WebpageEvidenceAnalysisToolId. */
export type MirrorAnalysisToolId = typeof WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS[number]
/** @deprecated Use WebpageEvidenceAcceptanceToolId. */
export type MirrorAcceptanceToolId = typeof WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS[number]

/** @deprecated Use isWebpageEvidenceToolId. */
export const isMirrorToolId = isWebpageEvidenceToolId
/** @deprecated Use isWebpageEvidenceAnalysisToolId. */
export const isMirrorAnalysisToolId = isWebpageEvidenceAnalysisToolId
/** @deprecated Use isWebpageEvidenceAcceptanceToolId. */
export const isMirrorAcceptanceToolId = isWebpageEvidenceAcceptanceToolId
