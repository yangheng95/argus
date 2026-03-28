import type { Calculator } from './types';
import { DivisionByZeroError } from './types';

/**
 * SimpleCalc class implementing a fluent interface calculator
 * Supports chainable arithmetic operations: add, subtract, multiply, divide
 */
export class SimpleCalc implements Calculator {
  private _value: number;

  /**
   * Create a new SimpleCalc instance
   * @param initialValue - The starting value for calculations
   */
  constructor(initialValue: number) {
    this._value = initialValue;
  }

  /**
   * Add a value to the current result
   * @param value - The value to add
   * @returns this instance for chaining
   */
  add(value: number): this {
    this._value += value;
    return this;
  }

  /**
   * Subtract a value from the current result
   * @param value - The value to subtract
   * @returns this instance for chaining
   */
  subtract(value: number): this {
    this._value -= value;
    return this;
  }

  /**
   * Multiply the current result by a value
   * @param value - The value to multiply by
   * @returns this instance for chaining
   */
  multiply(value: number): this {
    this._value *= value;
    return this;
  }

  /**
   * Multiply the current result by a value (alias for multiply)
   * @param value - The value to multiply by
   * @returns this instance for chaining
   */
  mul(value: number): this {
    return this.multiply(value);
  }

  /**
   * Divide the current result by a value
   * @param value - The value to divide by
   * @returns this instance for chaining
   * @throws DivisionByZeroError if value is 0
   */
  divide(value: number): this {
    if (value === 0) {
      throw new DivisionByZeroError();
    }
    this._value /= value;
    return this;
  }

  /**
   * Get the current result
   * @returns The current calculated value
   */
  result(): number {
    return this._value;
  }
}

/**
 * Factory function to create a new SimpleCalc instance
 * @param initialValue - The starting value for calculations
 * @returns A new SimpleCalc instance
 */
export function calc(initialValue: number): SimpleCalc {
  return new SimpleCalc(initialValue);
}
