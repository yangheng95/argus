/**
 * Custom error thrown when attempting to divide by zero
 */
export class DivisionByZeroError extends Error {
  constructor(message?: string) {
    super(message ?? 'Division by zero is not allowed');
    this.name = 'DivisionByZeroError';
  }
}

/**
 * Calculator interface defining the fluent interface for chainable operations
 */
export interface Calculator {
  /**
   * Add a value to the current result
   * @param value - The value to add
   * @returns this instance for chaining
   */
  add(value: number): this;

  /**
   * Subtract a value from the current result
   * @param value - The value to subtract
   * @returns this instance for chaining
   */
  subtract(value: number): this;

  /**
   * Multiply the current result by a value
   * @param value - The value to multiply by
   * @returns this instance for chaining
   */
  multiply(value: number): this;

  /**
   * Multiply the current result by a value (alias for multiply)
   * @param value - The value to multiply by
   * @returns this instance for chaining
   */
  mul(value: number): this;

  /**
   * Divide the current result by a value
   * @param value - The value to divide by
   * @returns this instance for chaining
   * @throws DivisionByZeroError if value is 0
   */
  divide(value: number): this;

  /**
   * Get the current result
   * @returns The current calculated value
   */
  result(): number;
}

/**
 * Extended calculator type that includes the initial value
 */
export type SimpleCalcType = Calculator & {
  initialValue: number;
};
