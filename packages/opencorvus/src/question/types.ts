import z from "zod"

/**
 * Pure zod schemas for question data shapes — extracted from
 * `question/index.ts` so that consumers who only need the schemas (e.g.
 * `engine/model.ts`) don't pull in the full Question module's runtime
 * dependencies (`@/bus`, `@/project/instance`, etc.).
 *
 * Same rationale as `snapshot/types.ts`: a barrel-loaded module that only
 * needs a schema must not be forced through the runtime module's import
 * chain, which can transitively load `Instance.state(...)` callsites before
 * Instance has finished its own init.
 *
 * `question/index.ts` re-exports `Answer` inside its `Question` namespace
 * so existing `Question.Answer` callsites work unchanged.
 */

export const Answer = z.array(z.string()).meta({
  ref: "QuestionAnswer",
})
export type Answer = z.infer<typeof Answer>
