# Diary Module

日记应用 MVP 模块，提供日记条目的创建、读取、更新、删除、列表和搜索功能。

## 概述

本模块实现了完整的日记管理功能，包括：
- 数据库表定义（使用 Drizzle ORM）
- 存储层 API
- 工具定义（用于 AI 助手调用）

## 数据库 Schema

### DiaryTable

表名：`diary`

| 字段 | 类型 | 描述 |
|------|------|------|
| id | text | 主键，UUID |
| date | text | 日记日期，格式：YYYY-MM-DD |
| title | text | 日记标题 |
| content | text | 日记内容 |
| time_created | integer | 创建时间戳（毫秒） |
| time_updated | integer | 更新时间戳（毫秒） |

### 索引

- `diary_date_idx`: 在 `date` 字段上创建索引，加速日期查询

## 存储层 API

在 `src/diary/diary.ts` 中实现的 `Diary` 命名空间提供了以下方法：

### create(entry)

创建新的日记条目。

**参数：**
- `entry.date`: string - 日期（YYYY-MM-DD）
- `entry.title`: string - 标题
- `entry.content`: string - 内容

**返回：** `Entry` - 创建的日记条目（包含生成的 id 和时间戳）

### read(id)

读取指定 ID 的日记条目。

**参数：**
- `id`: string - 日记条目 ID

**返回：** `Entry | null` - 日记条目，不存在则返回 null

### update(id, entry)

更新日记条目。

**参数：**
- `id`: string - 日记条目 ID
- `entry.date?`: string - 新日期（可选）
- `entry.title?`: string - 新标题（可选）
- `entry.content?`: string - 新内容（可选）

**返回：** `Entry | null` - 更新后的日记条目，不存在则返回 null

### remove(id)

删除日记条目。

**参数：**
- `id`: string - 日记条目 ID

**返回：** `boolean` - 是否成功删除

### list(options)

列出日记条目。

**参数：**
- `options.limit?`: number - 最大返回数量（默认 100）
- `options.offset?`: number - 跳过数量（默认 0）
- `options.sortBy?`: "date" | "time_created" | "time_updated" - 排序字段（默认 "date"）
- `options.sortOrder?`: "asc" | "desc" - 排序顺序（默认 "desc"）

**返回：** `Entry[]` - 日记条目列表

### search(query)

搜索日记条目。

**参数：**
- `query.dateFrom?`: string - 起始日期（YYYY-MM-DD）
- `query.dateTo?`: string - 结束日期（YYYY-MM-DD）
- `query.title?`: string - 搜索关键词（匹配标题和内容）

**返回：** `Entry[]` - 匹配的日记条目列表

## 工具列表

以下工具已注册到工具系统中，可供 AI 助手使用：

| 工具名称 | 描述 |
|----------|------|
| `diary_create` | 创建新的日记条目 |
| `diary_read` | 读取指定 ID 的日记条目 |
| `diary_update` | 更新日记条目 |
| `diary_delete` | 删除日记条目 |
| `diary_list` | 列出日记条目（支持分页和排序） |
| `diary_search` | 搜索日记条目（按日期范围和关键词） |

## 使用示例

### 创建日记

```typescript
import { Diary } from "@/diary/diary"

const entry = Diary.create({
  date: "2026-03-11",
  title: "今天的工作",
  content: "今天完成了日记应用的 MVP 开发。",
})
```

### 读取日记

```typescript
const entry = Diary.read("uuid-here")
if (entry) {
  console.log(entry.title, entry.content)
}
```

### 搜索日记

```typescript
const results = Diary.search({
  dateFrom: "2026-03-01",
  dateTo: "2026-03-31",
  title: "工作",
})
```

## 权限模型

所有日记工具都使用 `ctx.ask()` 进行权限请求，权限类型分别为：
- `diary_create`
- `diary_read`
- `diary_update`
- `diary_delete`
- `diary_list`
- `diary_search`

## 事务处理

存储层的所有写操作（create、update、remove）都使用 `Database.transaction()` 确保数据一致性和原子性。
