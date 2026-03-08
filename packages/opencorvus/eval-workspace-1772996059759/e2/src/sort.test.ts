import { test, expect } from "bun:test";
import { sortNumbers, sortDescending, findMedian } from "./sort";

test("sortNumbers basic", () => {
  expect(sortNumbers([3, 1, 2])).toEqual([1, 2, 3]);
});

test("sortNumbers with larger numbers", () => {
  expect(sortNumbers([10, 9, 2, 100, 1])).toEqual([1, 2, 9, 10, 100]);
});

test("sortDescending", () => {
  expect(sortDescending([1, 5, 3, 10, 2])).toEqual([10, 5, 3, 2, 1]);
});

test("findMedian odd length", () => {
  expect(findMedian([3, 1, 2])).toBe(2);
});

test("findMedian even length", () => {
  expect(findMedian([1, 2, 3, 4])).toBe(2.5);
});

test("findMedian with large numbers", () => {
  expect(findMedian([100, 1, 50])).toBe(50);
});