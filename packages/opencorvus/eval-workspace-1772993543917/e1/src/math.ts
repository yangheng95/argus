/**
 * Math utility module providing basic arithmetic operations.
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
 * @param a - Dividend
 * @param b - Divisor
 * @returns The quotient of a and b
 * @throws Error if b is zero
 */
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

/**
 * Clamps a value within the specified range [min, max].
 * @param value - The value to clamp
 * @param min - The minimum value of the range
 * @param max - The maximum value of the range
 * @returns The clamped value within [min, max]
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
