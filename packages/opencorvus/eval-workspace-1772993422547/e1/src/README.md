# Hello World 模块

提供简单的问候语生成功能。

## API

### `helloWorld(name?: string): string`

生成问候语字符串。

**参数：**

- `name` (可选) - 要问候的对象名称，默认为 `'World'`

**返回值：**

- 格式化的问候字符串，格式为 `'Hello, {name}!'`

## 使用示例

```typescript
import { helloWorld } from "./hello"

// 使用默认参数
console.log(helloWorld()) // 输出：Hello, World!

// 传入自定义名称
console.log(helloWorld("Alice")) // 输出：Hello, Alice!
```
