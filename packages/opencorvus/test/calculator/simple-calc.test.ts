import { describe, test, expect } from 'bun:test';
import { calc, DivisionByZeroError } from '../../src/calculator';

describe('SimpleCalc', () => {
  describe('Basic Operations', () => {
    test('should add values correctly', () => {
      const result = calc(1).add(2).result();
      expect(result).toBe(3);
    });

    test('should subtract values correctly', () => {
      const result = calc(5).subtract(2).result();
      expect(result).toBe(3);
    });

    test('should multiply values correctly', () => {
      const result = calc(3).multiply(4).result();
      expect(result).toBe(12);
    });

    test('should divide values correctly', () => {
      const result = calc(10).divide(2).result();
      expect(result).toBe(5);
    });
  });

  describe('Chainable Operations', () => {
    test('should support chain addition', () => {
      const result = calc(1).add(2).add(3).add(4).result();
      expect(result).toBe(10);
    });

    test('should support mixed chain operations', () => {
      const result = calc(1).add(2).multiply(3).result();
      expect(result).toBe(9);
    });

    test('should support complex chain operations', () => {
      const result = calc(10)
        .add(5)
        .subtract(3)
        .multiply(2)
        .divide(4)
        .result();
      expect(result).toBe(6);
    });

    test('should support the example chain: calc(1).add(2).mul(3)', () => {
      const result = calc(1).add(2).mul(3).result();
      expect(result).toBe(9);
    });

    test('should support mul alias method', () => {
      const result = calc(5).mul(4).result();
      expect(result).toBe(20);
    });

    test('should support chain with mul alias', () => {
      const result = calc(2).add(3).mul(4).subtract(5).result();
      expect(result).toBe(15);
    });
  });

  describe('Edge Cases', () => {
    test('should handle negative numbers', () => {
      const result = calc(-5).add(3).result();
      expect(result).toBe(-2);
    });

    test('should handle zero as initial value', () => {
      const result = calc(0).multiply(5).result();
      expect(result).toBe(0);
    });

    test('should handle decimal numbers', () => {
      const result = calc(1.5).add(2.5).result();
      expect(result).toBe(4);
    });

    test('should handle division resulting in decimals', () => {
      const result = calc(7).divide(2).result();
      expect(result).toBe(3.5);
    });

    test('should handle multiple operations with negative numbers', () => {
      const result = calc(-10).add(5).multiply(-2).result();
      expect(result).toBe(10);
    });
  });

  describe('Error Handling', () => {
    test('should throw DivisionByZeroError when dividing by zero', () => {
      expect(() => calc(5).divide(0)).toThrow(DivisionByZeroError);
    });

    test('should throw DivisionByZeroError with correct message', () => {
      try {
        calc(5).divide(0).result();
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DivisionByZeroError);
        expect((error as Error).message).toBe('Division by zero is not allowed');
      }
    });

    test('should not throw when dividing by non-zero', () => {
      expect(() => calc(5).divide(0.001)).not.toThrow();
    });
  });

  describe('Method Chaining', () => {
    test('should return this from add method', () => {
      const calculator = calc(5);
      const returned = calculator.add(3);
      expect(returned).toBe(calculator);
    });

    test('should return this from subtract method', () => {
      const calculator = calc(5);
      const returned = calculator.subtract(3);
      expect(returned).toBe(calculator);
    });

    test('should return this from multiply method', () => {
      const calculator = calc(5);
      const returned = calculator.multiply(3);
      expect(returned).toBe(calculator);
    });

    test('should return this from divide method', () => {
      const calculator = calc(5);
      const returned = calculator.divide(2);
      expect(returned).toBe(calculator);
    });

    test('should return this from mul method', () => {
      const calculator = calc(5);
      const returned = calculator.mul(3);
      expect(returned).toBe(calculator);
    });
  });
});
