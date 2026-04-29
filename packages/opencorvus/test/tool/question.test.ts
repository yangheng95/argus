import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import { QuestionTool } from "../../src/tool/question"
import * as QuestionModule from "../../src/question"

const ctx = {
  sessionID: "test-session",
  messageID: "test-message",
  callID: "test-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.question", () => {
  // audit-2026-04-29 W2-V32 — pre-fix the test mocked
  // `Question.ask` but `QuestionTool.execute` calls
  // `Question.askAndFormat`, and askAndFormat calls a LOCAL `ask`
  // reference (question/index.ts:239 `const answers = await
  // ask(input)`). The spy on the namespace export didn't catch
  // the local-binding call → real ask ran → "No context found
  // for instance" because no Instance.provide wraps the test.
  // Mock `askAndFormat` directly so the consumer-side mock
  // covers the boundary the production caller actually uses.
  let askAndFormatSpy: any

  beforeEach(() => {
    askAndFormatSpy = spyOn(QuestionModule.Question, "askAndFormat").mockResolvedValue({
      output: "stub",
      answers: [],
    })
  })

  afterEach(() => {
    askAndFormatSpy.mockRestore()
  })

  test("should successfully execute with valid question parameters", async () => {
    const tool = await QuestionTool.init()
    const questions = [
      {
        question: "What is your favorite color?",
        header: "Color",
        options: [
          { label: "Red", description: "The color of passion" },
          { label: "Blue", description: "The color of sky" },
        ],
        multiple: false,
      },
    ]

    askAndFormatSpy.mockResolvedValueOnce({ output: "User answered: Red", answers: [["Red"]] })

    const result = await tool.execute({ questions }, ctx)
    expect(askAndFormatSpy).toHaveBeenCalledTimes(1)
    expect(result.title).toBe("Asked 1 question")
  })

  test("should now pass with a header longer than 12 but less than 30 chars", async () => {
    const tool = await QuestionTool.init()
    const questions = [
      {
        question: "What is your favorite animal?",
        header: "This Header is Over 12",
        options: [{ label: "Dog", description: "Man's best friend" }],
      },
    ]

    askAndFormatSpy.mockResolvedValueOnce({
      output: `User answered:\n"What is your favorite animal?"="Dog"`,
      answers: [["Dog"]],
    })

    const result = await tool.execute({ questions }, ctx)
    expect(result.output).toContain(`"What is your favorite animal?"="Dog"`)
  })

  // intentionally removed the zod validation due to tool call errors, hoping prompting is gonna be good enough
  //   test("should throw an Error for header exceeding 30 characters", async () => {
  //     const tool = await QuestionTool.init()
  //     const questions = [
  //       {
  //         question: "What is your favorite animal?",
  //         header: "This Header is Definitely More Than Thirty Characters Long",
  //         options: [{ label: "Dog", description: "Man's best friend" }],
  //       },
  //     ]
  //     try {
  //       await tool.execute({ questions }, ctx)
  //       // If it reaches here, the test should fail
  //       expect(true).toBe(false)
  //     } catch (e: any) {
  //       expect(e).toBeInstanceOf(Error)
  //       expect(e.cause).toBeInstanceOf(z.ZodError)
  //     }
  //   })

  //   test("should throw an Error for label exceeding 30 characters", async () => {
  //     const tool = await QuestionTool.init()
  //     const questions = [
  //       {
  //         question: "A question with a very long label",
  //         header: "Long Label",
  //         options: [
  //           { label: "This is a very, very, very long label that will exceed the limit", description: "A description" },
  //         ],
  //       },
  //     ]
  //     try {
  //       await tool.execute({ questions }, ctx)
  //       // If it reaches here, the test should fail
  //       expect(true).toBe(false)
  //     } catch (e: any) {
  //       expect(e).toBeInstanceOf(Error)
  //       expect(e.cause).toBeInstanceOf(z.ZodError)
  //     }
  //   })
})
