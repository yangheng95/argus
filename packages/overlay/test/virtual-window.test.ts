import { describe, expect, test } from "bun:test";
import { buildVirtualWindowLayout, computeVirtualWindowRange } from "../src/utils/virtual-window";

describe("computeVirtualWindowRange", () => {
  test("returns an empty range for an empty list", () => {
    const layout = buildVirtualWindowLayout({
      count: 0,
      estimatedItemSize: 100,
      getItemSize: () => 100,
    });
    expect(computeVirtualWindowRange(layout, {
      scrollTop: 0,
      viewportHeight: 600,
      overscanPx: 400,
    })).toEqual({
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalSize: 0,
    });
  });

  test("includes only the overscanned window and keeps spacer heights", () => {
    const layout = buildVirtualWindowLayout({
      count: 100,
      estimatedItemSize: 50,
      getItemSize: () => 50,
    });
    const range = computeVirtualWindowRange(layout, {
      scrollTop: 500,
      viewportHeight: 300,
      overscanPx: 100,
    });

    expect(range).toEqual({
      startIndex: 7,
      endIndex: 19,
      paddingTop: 350,
      paddingBottom: 4050,
      totalSize: 5000,
    });
  });

  test("uses measured item sizes when available", () => {
    const sizes = [40, 60, 200, 50, 50];
    const layout = buildVirtualWindowLayout({
      count: sizes.length,
      estimatedItemSize: 50,
      getItemSize: (index) => sizes[index],
    });
    const range = computeVirtualWindowRange(layout, {
      scrollTop: 90,
      viewportHeight: 80,
      overscanPx: 0,
    });

    expect(range).toEqual({
      startIndex: 1,
      endIndex: 3,
      paddingTop: 40,
      paddingBottom: 100,
      totalSize: 400,
    });
  });

  test("falls back to the estimate for invalid measurements", () => {
    const layout = buildVirtualWindowLayout({
      count: 3,
      estimatedItemSize: 30,
      getItemSize: (index) => index === 1 ? 0 : undefined,
    });
    const range = computeVirtualWindowRange(layout, {
      scrollTop: 0,
      viewportHeight: 90,
      overscanPx: 0,
    });

    expect(range.totalSize).toBe(90);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(3);
  });
});
