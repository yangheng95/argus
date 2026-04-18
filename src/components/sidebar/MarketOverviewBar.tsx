import type { MarketIndex } from '../../types/index.js';

/**
 * MarketOverviewBar displays major market indices
 * Expected indices: DJI (Dow Jones), QQQ (Nasdaq-100), SPY (S&P 500)
 */

export interface MarketOverviewBarProps {
  indices: MarketIndex[];
}

export const MarketOverviewBar: React.FC<MarketOverviewBarProps> = ({ indices }) => {
  const formatChange = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const getChangeColor = (value: number) => {
    if (value > 0) return 'text-[var(--color-up)]';
    if (value < 0) return 'text-[var(--color-down)]';
    return 'text-[var(--color-text-secondary)]';
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-secondary)] border-b border-[var(--color-separator)]">
      {indices.map((index) => (
        <div key={index.symbol} className="flex flex-col items-center">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            {index.name}
          </span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
              {index.price.toFixed(2)}
            </span>
            <span className={`text-xs font-medium tabular-nums ${getChangeColor(index.changePercent)}`}>
              {formatChange(index.changePercent)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};
