import { test, expect, describe } from 'bun:test';
import { add, subtract, multiply, divide, clamp } from './math';

/**
 * Comprehensive test suite for math utility functions.
 * Covers normal cases and edge cases for all 5 functions.
 */

describe('add', () => {
  test('should add two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  test('should add negative and positive numbers', () => {
    expect(add(-1, 1)).toBe(0);
  });

  test('should add two zeros', () => {
    expect(add(0, 0)).toBe(0);
  });
});

describe('subtract', () => {
  test('should subtract two positive numbers', () => {
    expect(subtract(5, 3)).toBe(2);
  });

  test('should subtract when result is negative', () => {
    expect(subtract(0, 5)).toBe(-5);
  });

  test('should subtract two negative numbers', () => {
    expect(subtract(-1, -1)).toBe(0);
  });
});

describe('multiply', () => {
  test('should multiply two positive numbers', () => {
    expect(multiply(4, 3)).toBe(12);
  });

  test('should multiply by zero', () => {
    expect(multiply(0, 5)).toBe(0);
  });

  test('should multiply negative and positive numbers', () => {
    expect(multiply(-2, 3)).toBe(-6);
  });
});

describe('divide', () => {
  test('should divide two positive numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  test('should divide and return decimal result', () => {
    expect(divide(1, 4)).toBe(0.25);
  });

  test('should throw error when dividing by zero', () => {
    expect(() => divide(1, 0)).toThrow('Division by zero');
  });
});

describe('clamp', () => {
  test('should return value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  test('should return min when value is below range', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  test('should return max when value is above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  test('should return min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  test('should return max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });
});
