# SimpleCalc - Fluent Interface Calculator

A TypeScript calculator module implementing the Fluent Interface pattern for chainable arithmetic operations.

## Features

- **Chainable Operations**: Write calculations in a fluent, readable style
- **Type Safety**: Full TypeScript type definitions
- **Error Handling**: Custom `DivisionByZeroError` for division by zero attempts
- **Basic Arithmetic**: Support for addition, subtraction, multiplication, and division

## Usage

### Basic Operations

```typescript
import { calc } from './calculator';

// Addition
const result1 = calc(5).add(3).result(); // 8

// Subtraction
const result2 = calc(10).subtract(4).result(); // 6

// Multiplication
const result3 = calc(3).multiply(4).result(); // 12

// Division
const result4 = calc(20).divide(5).result(); // 4
```

### Chainable Operations

```typescript
// Chain multiple operations
const result = calc(1).add(2).multiply(3).result(); // 9

// Complex chains
const complex = calc(10)
  .add(5)      // 15
  .subtract(3) // 12
  .multiply(2) // 24
  .divide(4)   // 6
  .result();   // 6
```

### Error Handling

```typescript
import { calc, DivisionByZeroError } from './calculator';

try {
  calc(5).divide(0).result();
} catch (error) {
  if (error instanceof DivisionByZeroError) {
    console.error('Cannot divide by zero!');
  }
}
```

## API

### `calc(initialValue: number): SimpleCalc`

Factory function to create a new calculator instance.

**Parameters:**
- `initialValue` - The starting value for calculations

**Returns:** A new `SimpleCalc` instance

### SimpleCalc Methods

All methods return `this` to enable chaining:

- **`.add(value: number)`** - Add a value to the current result
- **`.subtract(value: number)`** - Subtract a value from the current result
- **`.multiply(value: number)`** - Multiply the current result by a value
- **`.divide(value: number)`** - Divide the current result by a value
- **`.result()`** - Get the final calculated value

### Exceptions

- **`DivisionByZeroError`** - Thrown when attempting to divide by zero

## Examples

```typescript
import { calc, DivisionByZeroError } from './calculator';

// Simple calculation
calc(1).add(2).mul(3).result(); // 9

// Working with negative numbers
calc(-5).add(3).result(); // -2

// Working with zero
calc(0).multiply(5).result(); // 0

// Working with decimals
calc(1.5).add(2.5).result(); // 4

// Division by zero protection
try {
  calc(5).divide(0).result();
} catch (e) {
  // e is DivisionByZeroError
}
```
