import { Hono } from "hono"
import { createNote } from "./service"
import { validateContent } from "./text-processor"

const routes = new Hono()

/**
 * POST /api/v1/notes
 * 创建新笔记
 */
routes.post("/notes", async (c) => {
  try {
    const body = await c.req.json()
    const { content } = body

    // 验证内容
    if (!content || typeof content !== "string") {
      return c.json({ code: 400, error: "content 是必需的且必须是字符串" }, 400)
    }

    if (!validateContent(content)) {
      return c.json({ code: 400, error: "内容长度不能超过 2000 字符" }, 400)
    }

    // 创建笔记
    const result = createNote({ content })

    return c.json({ code: 200, data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    return c.json({ code: 500, error: message }, 500)
  }
})

export { routes }
