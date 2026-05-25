export interface VirtualWindowLayoutOptions {
  count: number;
  estimatedItemSize: number;
  getItemSize: (index: number) => number | undefined;
}

export interface VirtualWindowRangeOptions {
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
}

export interface VirtualWindowLayout {
  count: number;
  offsets: number[];
  totalSize: number;
}

export interface VirtualWindowRange {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
  totalSize: number;
}

function itemSize(value: number | undefined, estimatedItemSize: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return Math.max(1, estimatedItemSize);
}

export function buildVirtualWindowLayout(options: VirtualWindowLayoutOptions): VirtualWindowLayout {
  const count = Math.max(0, Math.floor(options.count));
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) {
    offsets[i + 1] = offsets[i] + itemSize(options.getItemSize(i), options.estimatedItemSize);
  }
  return {
    count,
    offsets,
    totalSize: offsets[count] ?? 0,
  };
}

export function virtualOffsetForIndex(layout: VirtualWindowLayout, index: number): number {
  const safeIndex = Math.max(0, Math.min(layout.count, Math.floor(index)));
  return layout.offsets[safeIndex] ?? 0;
}

function findStartIndex(layout: VirtualWindowLayout, startPx: number): number {
  let lo = 0;
  let hi = layout.count;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((layout.offsets[mid + 1] ?? 0) < startPx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function findEndIndex(layout: VirtualWindowLayout, endPx: number, startIndex: number): number {
  let lo = startIndex;
  let hi = layout.count;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((layout.offsets[mid] ?? 0) <= endPx) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(layout.count, Math.max(startIndex + 1, lo));
}

export function computeVirtualWindowRange(
  layout: VirtualWindowLayout,
  options: VirtualWindowRangeOptions,
): VirtualWindowRange {
  const count = layout.count;
  if (count === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalSize: 0,
    };
  }

  const totalSize = layout.totalSize;
  const startPx = Math.max(0, options.scrollTop - Math.max(0, options.overscanPx));
  const endPx = Math.min(
    totalSize,
    Math.max(startPx, options.scrollTop + Math.max(0, options.viewportHeight) + Math.max(0, options.overscanPx)),
  );

  const startIndex = findStartIndex(layout, startPx);
  const endIndex = findEndIndex(layout, endPx, startIndex);

  return {
    startIndex,
    endIndex,
    paddingTop: virtualOffsetForIndex(layout, startIndex),
    paddingBottom: Math.max(0, totalSize - virtualOffsetForIndex(layout, endIndex)),
    totalSize,
  };
}
