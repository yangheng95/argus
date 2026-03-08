/**
 * 对数字数组进行升序排序
 * 使用数值比较器 (a - b) 避免 JavaScript 默认的字符串排序
 * 例如：[10, 9, 2, 100, 1] → [1, 2, 9, 10, 100] 而非 [1, 10, 100, 2, 9]
 */
export function sortNumbers(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

/**
 * 对数字数组进行降序排序
 * 使用数值比较器 (b - a) 直接降序，比先升序再反转更高效
 * 例如：[1, 5, 3, 10, 2] → [10, 5, 3, 2, 1]
 */
export function sortDescending(arr: number[]): number[] {
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