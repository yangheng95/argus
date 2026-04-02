import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { createNote, getNote, listNotes, deleteNote } from "../../quicknote/service"
import { lazy } from "../../util/lazy"

/**
 * QuickNote API 路由
 * 提供笔记相关的 RESTful API 接口
 */
export const QuickNoteRoutes = lazy(() =>
  new Hono()
    .post(
      "/notes",
      describeRoute({
        summary: "创建笔记",
        description: "创建新的快速笔记，自动提取标题和生成摘要",
        operationId: "quicknote.create",
        request: {
          body: {
            description: "笔记创建参数",
            required: true,
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    content: z.string().min(1).max(2000).meta({
                      description: "笔记内容（最多 2000 字符）",
                    }),
                  }),
                ),
              },
            },
          },
        },
        responses: {
          200: {
            description: "笔记创建成功",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    note_id: z.string().meta({
                      description: "笔记 ID",
                    }),
                    summary: z.string().meta({
                      description: "自动生成的摘要（前 15 字符）",
                    }),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          content: z.string().min(1).max(2000),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const content = body.content

        try {
          const result = createNote({ content })

          return c.json({
            note_id: result.note_id,
            summary: result.summary,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : "创建笔记失败"
          return c.json({ error: message }, 400)
        }
      },
    )
    .get(
      "/notes",
      describeRoute({
        summary: "获取笔记列表",
        description: "获取所有笔记的列表",
        operationId: "quicknote.list",
        responses: {
          200: {
            description: "笔记列表",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      note_id: z.string(),
                      content: z.string(),
                      summary: z.string(),
                      tags: z.string(),
                      status: z.number(),
                      created_at: z.number(),
                      updated_at: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const notes = listNotes()
        return c.json(notes)
      },
    )
    .get(
      "/notes/:id",
      describeRoute({
        summary: "获取笔记",
        description: "根据 ID 获取笔记详情",
        operationId: "quicknote.get",
        responses: {
          200: {
            description: "笔记详情",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    note_id: z.string(),
                    content: z.string(),
                    summary: z.string(),
                    tags: z.string(),
                    status: z.number(),
                    created_at: z.number(),
                    updated_at: z.number(),
                  }),
                ),
              },
            },
          },
          404: {
            description: "笔记不存在",
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const note = getNote(id)

        if (!note) {
          return c.json({ error: "笔记不存在" }, 404)
        }

        return c.json(note)
      },
    )
    .delete(
      "/notes/:id",
      describeRoute({
        summary: "删除笔记",
        description: "根据 ID 删除笔记",
        operationId: "quicknote.delete",
        responses: {
          200: {
            description: "删除成功",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                  }),
                ),
              },
            },
          },
          404: {
            description: "笔记不存在",
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const result = deleteNote(id)

        if (!result) {
          return c.json({ error: "笔记不存在" }, 404)
        }

        return c.json({ success: true })
      },
    )
)
