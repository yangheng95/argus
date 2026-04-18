/**
 * XML IR — a compact XML string produced by `figma/compile` or `url/compile`
 * that downstream consumers (codegen agent / visual tools / skill steps) feed
 * as design intent.
 *
 * The string itself is the payload; metadata (byte count, per-section byte
 * ranges, token-budget hints) is carried alongside so callers can truncate
 * or slice without re-parsing.
 */

import z from "zod"

export const XmlIRSectionRangeSchema = z.object({
  /** Byte offset of the section's opening tag. */
  start: z.number(),
  /** Byte offset one past the section's closing tag. */
  end: z.number(),
})

export const XmlIRSchema = z.object({
  /** Origin of the IR — callers may route to source-specific handling. */
  source: z.enum(["figma", "url"]),
  /** The XML payload. */
  xml: z.string(),
  /** Byte length of `xml` (UTF-8). Denormalised for quick budget checks. */
  bytes: z.number(),
  /**
   * Optional index of logical sections (e.g. `page[0]`, `frame:Header`,
   * `section:#hero`) to their byte ranges within `xml`. Allows consumers to
   * slice a single section without re-parsing the whole document.
   */
  sectionIndex: z.record(z.string(), XmlIRSectionRangeSchema).optional(),
  /**
   * Estimated token count (via `shared/token-estimator`) — recorded at
   * compile time so downstream callers can budget without recomputing.
   */
  estimatedTokens: z.number().optional(),
})

export type XmlIR = z.infer<typeof XmlIRSchema>
export type XmlIRSectionRange = z.infer<typeof XmlIRSectionRangeSchema>
