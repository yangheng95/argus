/**
 * Math utility module providing basic arithmetic operations.
 * All functions use TypeScript strict mode with explicit number types.
 */

/**
 * Adds two numbers together.
 * @param a - First number
 * @param b - Second number
 * @returns The sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Subtracts the second number from the first.
 * @param a - First number (minuend)
 * @param b - Second number (subtrahend)
 * @returns The difference of a and b
 */
export function subtract(a: number, b: number): number {
  return a - b;
}

/**
 * Multiplies two numbers.
 * @param a - First number
 * @param b - Second number
 * @returns The product of a and b
 */
export function multiply(a: number, b: number): number {
  return a * b;
}

/**
 * Divides the first number by the second.
 * @param a - Dividend (numerator)
 * @param b - Divisor (denominator)
 * @returns The quotient of a and b
 * @throws Error with message 'Division by zero' if b is 0
 */
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

/**
 * Clamps a value to be within the specified range [min, max].
 * Returns the value if it's within range, min if value < min, or max if value > max.
 * @param value - The value to clamp
 * @param min - The minimum bound (inclusive)
 * @param max - The maximum bound (inclusive)
 * @returns The clamped value
 * @note Assumes min <= max as precondition; behavior is undefined if min > max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
