# AI-QuickNote 模块

快速笔记模块，提供文本处理、笔记存储和 API 接口功能。

## 功能特性

### 1. 文本处理

- **自动标题提取**: 从内容中自动提取前 15 个字符作为标题
- **摘要生成**: 生成最多 100 字符的内容摘要
- **内容验证**: 验证输入内容长度（最多 2000 字符）

```typescript
import { processText, extractTitle, generateSummary } from "@/quicknote"

// 完整文本处理
const result = processText("这是一个测试笔记内容")
// result: { title: "这是一个测试笔记", summary: "这是一个测试笔记内容", valid: true }

// 单独提取标题
const title = extractTitle("这是一个很长的测试笔记内容")
// title: "这是一个测试笔记"

// 生成摘要
const summary = generateSummary("很长的内容...")
// summary: "很长的内容..." (最多 100 字符)
```

### 2. 数据对象结构

```typescript
interface QuickNote {
  note_id: string // UUID 格式：nte_xxxxx
  content: string // 笔记内容（最多 2000 字符）
  summary: string // 自动生成的摘要（最多 100 字符）
  tags: string[] // 标签数组
  status: "draft" | "published" | "archived" // 笔记状态
}
```

### 3. API 接口

#### 创建笔记

```http
POST /api/v1/notes
Content-Type: application/json

{
  "content": "笔记内容",
  "tags": ["标签 1", "标签 2"],
  "user_id": "用户 ID"
}
```

响应：

```json
{
  "note_id": "nte_abc123...",
  "summary": "自动生成的摘要"
}
```

#### 获取笔记

```http
GET /api/v1/notes/:id
```

响应：

```json
{
  "note_id": "nte_abc123...",
  "content": "笔记内容",
  "summary": "摘要",
  "tags": ["标签 1"],
  "status": "draft"
}
```

### 4. 服务层 API

```typescript
import { QuickNoteService } from "@/quicknote"

// 创建笔记
const note = await QuickNoteService.createNote({
  content: "笔记内容",
  tags: ["测试"],
  user_id: "user123",
})

// 获取笔记
const retrieved = QuickNoteService.getNoteById(note.note_id)

// 更新状态
QuickNoteService.updateNoteStatus(note.note_id, "published")

// 删除笔记
QuickNoteService.deleteNote(note.note_id)

// 获取用户的所有笔记
const userNotes = QuickNoteService.getNotesByUser("user123")
```

## 文件结构

```
src/quicknote/
├── quicknote.sql.ts    # 数据库 Schema
├── text-processor.ts   # 文本处理工具
├── service.ts          # 服务层
├── index.ts            # 模块入口
└── README.md           # 本文档

src/server/routes/
└── quicknote.ts        # API 路由

test/quicknote/
├── text-processor.test.ts  # 文本处理测试
├── service.test.ts         # 服务层测试
└── routes.test.ts          # API 路由测试
```

## 数据库 Schema

```sql
CREATE TABLE quick_note (
  id TEXT PRIMARY KEY,           -- note_id (nte_xxxxx)
  project_id TEXT,               -- 项目 ID
  content TEXT NOT NULL,         -- 笔记内容
  summary TEXT NOT NULL,         -- 摘要
  tags TEXT NOT NULL DEFAULT [], -- 标签 (JSON)
  status TEXT NOT NULL DEFAULT 'draft', -- 状态
  user_id TEXT,                  -- 用户 ID
  time_created INTEGER,          -- 创建时间
  time_updated INTEGER           -- 更新时间
)
```

## 运行测试

```bash
# 运行所有 QuickNote 测试
bun test test/quicknote/

# 运行特定测试文件
bun test test/quicknote/text-processor.test.ts
bun test test/quicknote/service.test.ts
bun test test/quicknote/routes.test.ts
```

## 限制

- 内容长度：最多 2000 字符
- 标题长度：固定 15 字符
- 摘要长度：最多 100 字符
- 标签数量：无限制（但建议合理数量）

## 状态说明

- **draft**: 草稿状态，新创建的笔记默认状态
- **published**: 已发布状态，表示笔记已完成
- **archived**: 已归档状态，表示笔记已归档不再活跃
