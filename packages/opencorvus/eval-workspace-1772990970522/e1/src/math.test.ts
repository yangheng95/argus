import { describe, expect, test } from 'bun:test';
import { add, subtract, multiply, divide, clamp } from './math';

describe('add', () => {
  test('should add two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  test('should add negative and positive numbers', () => {
    expect(add(-1, 1)).toBe(0);
  });

  test('should add two negative numbers', () => {
    expect(add(-5, -3)).toBe(-8);
  });

  test('should add zero', () => {
    expect(add(0, 5)).toBe(5);
    expect(add(5, 0)).toBe(5);
  });
});

describe('subtract', () => {
  test('should subtract smaller from larger', () => {
    expect(subtract(5, 3)).toBe(2);
  });

  test('should subtract larger from smaller', () => {
    expect(subtract(3, 5)).toBe(-2);
  });

  test('should subtract negative numbers', () => {
    expect(subtract(-2, 3)).toBe(-5);
    expect(subtract(5, -3)).toBe(8);
  });

  test('should subtract zero', () => {
    expect(subtract(5, 0)).toBe(5);
    expect(subtract(0, 5)).toBe(-5);
  });
});

describe('multiply', () => {
  test('should multiply two positive numbers', () => {
    expect(multiply(4, 5)).toBe(20);
  });

  test('should multiply negative and positive numbers', () => {
    expect(multiply(-2, 3)).toBe(-6);
    expect(multiply(2, -3)).toBe(-6);
  });

  test('should multiply two negative numbers', () => {
    expect(multiply(-4, -5)).toBe(20);
  });

  test('should multiply by zero', () => {
    expect(multiply(5, 0)).toBe(0);
    expect(multiply(0, 5)).toBe(0);
  });

  test('should multiply by one', () => {
    expect(multiply(7, 1)).toBe(7);
    expect(multiply(1, 7)).toBe(7);
  });
});

describe('divide', () => {
  test('should divide evenly', () => {
    expect(divide(10, 2)).toBe(5);
  });

  test('should divide with remainder', () => {
    expect(divide(7, 2)).toBe(3.5);
  });

  test('should divide zero by non-zero', () => {
    expect(divide(0, 5)).toBe(0);
  });

  test('should divide negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5);
    expect(divide(10, -2)).toBe(-5);
    expect(divide(-10, -2)).toBe(5);
  });

  test('should throw error when dividing by zero', () => {
    expect(() => divide(1, 0)).toThrow('Division by zero');
    expect(() => divide(0, 0)).toThrow('Division by zero');
    expect(() => divide(-5, 0)).toThrow('Division by zero');
  });
});

describe('clamp', () => {
  test('should return value when within range', () => {
    expect(clamp(5, 1, 10)).toBe(5);
  });

  test('should return min when value is below range', () => {
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(-100, 1, 10)).toBe(1);
  });

  test('should return max when value is above range', () => {
    expect(clamp(15, 1, 10)).toBe(10);
    expect(clamp(100, 1, 10)).toBe(10);
  });

  test('should return min when value equals min', () => {
    expect(clamp(1, 1, 10)).toBe(1);
  });

  test('should return max when value equals max', () => {
    expect(clamp(10, 1, 10)).toBe(10);
  });

  test('should handle negative ranges', () => {
    expect(clamp(-5, -10, 0)).toBe(-5);
    expect(clamp(-15, -10, 0)).toBe(-10);
    expect(clamp(5, -10, 0)).toBe(0);
  });
});
