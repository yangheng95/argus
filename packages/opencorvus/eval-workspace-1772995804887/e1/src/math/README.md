# Math 模块

数学工具模块，提供基础的数学运算函数。

## 函数列表

### add(a, b)

加法运算。

- **参数**:
  - `a: number` - 第一个加数
  - `b: number` - 第二个加数
- **返回**: `number` - 两数之和

```typescript
add(2, 3); // 5
add(-10, 20); // 10
add(0, 5); // 5
```

### subtract(a, b)

减法运算。

- **参数**:
  - `a: number` - 被减数
  - `b: number` - 减数
- **返回**: `number` - 两数之差 (a - b)

```typescript
subtract(5, 3); // 2
subtract(10, 20); // -10
subtract(-5, -3); // -2
```

### multiply(a, b)

乘法运算。

- **参数**:
  - `a: number` - 被乘数
  - `b: number` - 乘数
- **返回**: `number` - 两数之积

```typescript
multiply(3, 4); // 12
multiply(-3, 4); // -12
multiply(5, 0); // 0
multiply(5, 1); // 5
```

### divide(a, b)

除法运算。

- **参数**:
  - `a: number` - 被除数
  - `b: number` - 除数
- **返回**: `number` - 两数之商 (a / b)
- **异常**: 当除数为 0 时抛出 `Error('Division by zero')`

```typescript
divide(10, 2); // 5
divide(7, 2); // 3.5
divide(-10, 2); // -5

// 除以 0 会抛出错误
divide(10, 0); // throws Error: Division by zero
```

### clamp(value, min, max)

将值限制在指定范围内。

- **参数**:
  - `value: number` - 需要限制的值
  - `min: number` - 最小值边界
  - `max: number` - 最大值边界
- **返回**: `number` - 限制后的值，确保在 [min, max] 范围内

```typescript
clamp(5, 0, 10); // 5 (在范围内)
clamp(-5, 0, 10); // 0 (小于 min，返回 min)
clamp(15, 0, 10); // 10 (大于 max，返回 max)
clamp(0, 0, 10); // 0 (等于 min)
clamp(10, 0, 10); // 10 (等于 max)
```

## 边界情况说明

1. **除法**: 除以 0 时会抛出 `Error('Division by zero')` 错误，调用时需要确保除数不为 0 或使用 try-catch 捕获异常。

2. **clamp**: 
   - 如果 `min > max`，函数仍然会正常工作，但结果可能不符合预期（会返回 min 和 max 中的较小值或较大值）
   - 建议调用时确保 `min <= max`

## 使用示例

```typescript
import { add, subtract, multiply, divide, clamp } from './math';

// 基础运算
const sum = add(10, 20); // 30
const diff = subtract(10, 20); // -10
const product = multiply(10, 20); // 200
const quotient = divide(10, 20); // 0.5

// 安全除法
try {
  const result = divide(10, 0);
} catch (error) {
  console.error(error.message); // Division by zero
}

// 范围限制
const clampedValue = clamp(15, 0, 10); // 10
```
