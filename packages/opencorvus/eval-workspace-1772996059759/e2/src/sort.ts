export function sortNumbers(arr: number[]): number[] {
  // JavaScript 默认 sort() 使用字符串字典序排序，需传入数值比较器 (a-b) 实现升序排序
  return [...arr].sort((a, b) => a - b);
}

export function sortDescending(arr: number[]): number[] {
  // 使用数值比较器 (b-a) 直接实现降序排序，比 sort() 后 reverse() 更高效且语义清晰
  return [...arr].sort((a, b) => b - a);
}

export function findMedian(arr: number[]): number {
  // 中位数计算依赖正确的数值排序，sortNumbers 已修复为数值升序排序
  const sorted = sortNumbers(arr);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    // 偶数长度：返回中间两个数的平均值
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  // 奇数长度：返回中间的数
  return sorted[mid];
}