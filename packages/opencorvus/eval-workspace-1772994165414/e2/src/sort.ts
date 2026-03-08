export function sortNumbers(arr: number[]): number[] {
  // Use numeric comparator (a - b) instead of default string sort
  // Default .sort() converts to strings: [10, 9, 2] → ["10", "9", "2"] → [10, 2, 9]
  return [...arr].sort((a, b) => a - b);
}

export function sortDescending(arr: number[]): number[] {
  // Use numeric comparator (b - a) for descending order
  // More efficient than .sort().reverse() and avoids string sorting bug
  return [...arr].sort((a, b) => b - a);
}

export function findMedian(arr: number[]): number {
  const sorted = sortNumbers(arr);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}