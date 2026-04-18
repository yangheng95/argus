import type { Stock } from '../../types/index.js';

export interface KeyStatisticsProps {
  stock: Stock;
}

export const KeyStatistics: React.FC<KeyStatisticsProps> = ({ stock }) => {
  const formatNumber = (num: number, decimals = 2) => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatCompact = (num: number) => {
    if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    return formatNumber(num);
  };

  const getRangePosition = () => {
    const range = stock.week52Range.high - stock.week52Range.low;
    if (range === 0) return 50;
    return ((stock.price - stock.week52Range.low) / range) * 100;
  };

  const rangePosition = getRangePosition();

  const stats = [
    { label: "Day's Range", value: `${formatNumber(stock.dayRange.low)} - ${formatNumber(stock.dayRange.high)}` },
    { label: 'Avg Vol', value: stock.avgVolume ? formatCompact(stock.avgVolume) : 'N/A' },
    { label: 'Market Cap', value: stock.marketCap ? formatCompact(stock.marketCap) : 'N/A' },
    { label: 'P/E Ratio', value: stock.peRatio ? formatNumber(stock.peRatio) : 'N/A' },
    { label: 'Div Yield', value: '1.25%' },
  ];

  return (
    <div className="p-4 bg-[var(--color-bg-secondary)]">
      <h3 className="text-xs font-medium text-[var(--color-text-secondary)] mb-3">
        Key Statistics
      </h3>

      {/* 52 Week Range with visual bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[var(--color-text-secondary)]">52 Week Range</span>
          <span className="text-xs text-[var(--color-text-primary)] tabular-nums">
            {formatNumber(stock.week52Range.low)} - {formatNumber(stock.week52Range.high)}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--color-fill-primary)] overflow-hidden relative">
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent-blue)] z-10"
            style={{ left: `${rangePosition}%` }}
          />
        </div>
      </div>

      {/* Grid Stats */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map(({ label, value }) => (
          <div key={label} className="flex flex-col">
            <span className="text-xs text-[var(--color-text-tertiary)]">{label}</span>
            <span className="text-sm font-medium text-[var(--color-text-primary)] tabular-nums">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
