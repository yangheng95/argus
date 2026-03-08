import { test, expect, describe } from 'bun:test';
import { add, subtract, multiply, divide, clamp } from './math';

describe('add', () => {
  test('正数相加', () => {
    expect(add(2, 3)).toBe(5);
    expect(add(10, 20)).toBe(30);
  });

  test('负数相加', () => {
    expect(add(-2, -3)).toBe(-5);
    expect(add(-10, -20)).toBe(-30);
  });

  test('与 0 相加', () => {
    expect(add(5, 0)).toBe(5);
    expect(add(0, 5)).toBe(5);
    expect(add(0, 0)).toBe(0);
  });
});

describe('subtract', () => {
  test('正数相减', () => {
    expect(subtract(5, 3)).toBe(2);
    expect(subtract(10, 20)).toBe(-10);
  });

  test('负数相减', () => {
    expect(subtract(-5, -3)).toBe(-2);
    expect(subtract(-10, -20)).toBe(10);
  });

  test('减去 0', () => {
    expect(subtract(5, 0)).toBe(5);
    expect(subtract(0, 0)).toBe(0);
  });
});

describe('multiply', () => {
  test('正数相乘', () => {
    expect(multiply(3, 4)).toBe(12);
    expect(multiply(10, 20)).toBe(200);
  });

  test('负数相乘', () => {
    expect(multiply(-3, -4)).toBe(12);
    expect(multiply(-3, 4)).toBe(-12);
    expect(multiply(3, -4)).toBe(-12);
  });

  test('乘以 0', () => {
    expect(multiply(5, 0)).toBe(0);
    expect(multiply(0, 5)).toBe(0);
    expect(multiply(0, 0)).toBe(0);
  });

  test('乘以 1', () => {
    expect(multiply(5, 1)).toBe(5);
    expect(multiply(1, 5)).toBe(5);
    expect(multiply(1, 1)).toBe(1);
  });
});

describe('divide', () => {
  test('正常除法', () => {
    expect(divide(10, 2)).toBe(5);
    expect(divide(7, 2)).toBe(3.5);
    expect(divide(-10, 2)).toBe(-5);
    expect(divide(10, -2)).toBe(-5);
    expect(divide(-10, -2)).toBe(5);
  });

  test('除以 1', () => {
    expect(divide(5, 1)).toBe(5);
    expect(divide(-5, 1)).toBe(-5);
    expect(divide(1, 1)).toBe(1);
  });

  test('除以 0 抛出错误', () => {
    expect(() => divide(10, 0)).toThrow('Division by zero');
    expect(() => divide(-5, 0)).toThrow('Division by zero');
    expect(() => divide(0, 0)).toThrow('Division by zero');
  });
});

describe('clamp', () => {
  test('值在范围内', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(3, 1, 5)).toBe(3);
  });

  test('值小于 min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(2, 5, 10)).toBe(5);
  });

  test('值大于 max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(8, 1, 5)).toBe(5);
  });

  test('值等于 min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(5, 5, 10)).toBe(5);
  });

  test('值等于 max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
    expect(clamp(5, 1, 5)).toBe(5);
  });
});
