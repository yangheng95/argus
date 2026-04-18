/**
 * IR barrel — Zod schemas shared across mirror tools.
 *
 * Each module owns the schema for one boundary type. Tools validate their
 * inputs and outputs against these schemas; skills hand IR instances
 * between tools without re-normalisation.
 */
export * from "./compressed-design"
export * from "./extracted-page"
export * from "./xml-ir"
export * from "./scaffold"
