# Math Utility Module

数学工具模块，提供常用的数学运算函数。

## API

### `add(a: number, b: number): number`

加法运算，返回两数之和。

```typescript
add(2, 3);        // 5
add(-1, 1);       // 0
add(0.5, 0.5);    // 1
```

### `subtract(a: number, b: number): number`

减法运算，返回两数之差 (a - b)。

```typescript
subtract(5, 3);   // 2
subtract(3, 5);   // -2
subtract(0, 5);   // -5
```

### `multiply(a: number, b: number): number`

乘法运算，返回两数之积。

```typescript
multiply(4, 5);   // 20
multiply(-2, 3);  // -6
multiply(0, 5);   // 0
```

### `divide(a: number, b: number): number`

除法运算，返回两数之商 (a / b)。

**注意**: 当除数为 0 时抛出 `Error: Division by zero` 错误。

```typescript
divide(10, 2);    // 5
divide(7, 2);     // 3.5
divide(0, 5);     // 0
divide(1, 0);     // throws Error
```

### `clamp(value: number, min: number, max: number): number`

将值限制在指定范围内。如果 value < min 返回 min，如果 value > max 返回 max，否则返回 value。

```typescript
clamp(5, 1, 10);    // 5
clamp(0, 1, 10);    // 1
clamp(15, 1, 10);   // 10
clamp(-5, -10, 0);  // -5
```

## Usage

```typescript
import { add, subtract, multiply, divide, clamp } from './math';

const sum = add(10, 5);           // 15
const diff = subtract(10, 5);     // 5
const product = multiply(10, 5);  // 50
const quotient = divide(10, 5);   // 2
const clamped = clamp(15, 0, 10); // 10
```
