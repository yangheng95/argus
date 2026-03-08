import { expect, test, describe } from 'bun:test';
import { add, subtract, multiply, divide, clamp } from './math';

describe('add', () => {
  test('adds positive numbers', () => {
    expect(add(2, 3)).toBe(5);
    expect(add(10, 20)).toBe(30);
  });

  test('adds negative numbers', () => {
    expect(add(-2, -3)).toBe(-5);
    expect(add(-10, -20)).toBe(-30);
  });

  test('adds zero', () => {
    expect(add(0, 0)).toBe(0);
    expect(add(5, 0)).toBe(5);
    expect(add(0, 5)).toBe(5);
  });

  test('adds positive and negative numbers', () => {
    expect(add(5, -3)).toBe(2);
    expect(add(-5, 3)).toBe(-2);
  });
});

describe('subtract', () => {
  test('subtracts positive numbers', () => {
    expect(subtract(5, 3)).toBe(2);
    expect(subtract(10, 20)).toBe(-10);
  });

  test('subtracts negative numbers', () => {
    expect(subtract(-5, -3)).toBe(-2);
    expect(subtract(-10, -20)).toBe(10);
  });

  test('subtracts zero', () => {
    expect(subtract(0, 0)).toBe(0);
    expect(subtract(5, 0)).toBe(5);
    expect(subtract(0, 5)).toBe(-5);
  });

  test('subtracts positive and negative numbers', () => {
    expect(subtract(5, -3)).toBe(8);
    expect(subtract(-5, 3)).toBe(-8);
  });
});

describe('multiply', () => {
  test('multiplies positive numbers', () => {
    expect(multiply(2, 3)).toBe(6);
    expect(multiply(10, 20)).toBe(200);
  });

  test('multiplies negative numbers', () => {
    expect(multiply(-2, -3)).toBe(6);
    expect(multiply(-10, -20)).toBe(200);
  });

  test('multiplies by zero', () => {
    expect(multiply(0, 0)).toBe(0);
    expect(multiply(5, 0)).toBe(0);
    expect(multiply(0, 5)).toBe(0);
  });

  test('multiplies positive and negative numbers', () => {
    expect(multiply(5, -3)).toBe(-15);
    expect(multiply(-5, 3)).toBe(-15);
  });
});

describe('divide', () => {
  test('divides positive numbers', () => {
    expect(divide(6, 2)).toBe(3);
    expect(divide(10, 5)).toBe(2);
  });

  test('divides negative numbers', () => {
    expect(divide(-6, -2)).toBe(3);
    expect(divide(-10, -5)).toBe(2);
  });

  test('divides by zero throws error', () => {
    expect(() => divide(1, 0)).toThrow('Division by zero');
    expect(() => divide(0, 0)).toThrow('Division by zero');
    expect(() => divide(-5, 0)).toThrow('Division by zero');
  });

  test('divides positive and negative numbers', () => {
    expect(divide(6, -2)).toBe(-3);
    expect(divide(-6, 2)).toBe(-3);
  });

  test('divides resulting in decimals', () => {
    expect(divide(5, 2)).toBe(2.5);
    expect(divide(1, 3)).toBeCloseTo(0.3333333333333333);
  });
});

describe('clamp', () => {
  test('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test('returns min when value is below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(-100, 0, 10)).toBe(0);
  });

  test('returns max when value is above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(100, 0, 10)).toBe(10);
  });

  test('returns exact value when equals min boundary', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  test('returns exact value when equals max boundary', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test('handles negative ranges', () => {
    expect(clamp(-5, -10, 0)).toBe(-5);
    expect(clamp(-15, -10, 0)).toBe(-10);
    expect(clamp(5, -10, 0)).toBe(0);
  });
});
