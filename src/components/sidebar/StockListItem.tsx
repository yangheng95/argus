import { TrendingUp } from 'lucide-react';

/**
 * StockListItem displays individual stock information
 * Supports symbols: NVDA, AAPL, TSLA, GOOG, VOO, SOXX, IBIT
 */

export interface StockListItemProps {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  onClick?: () => void;
}

export const StockListItem: React.FC<StockListItemProps> = ({
  symbol,
  name,
  price,
  change: _change,
  changePercent,
  onClick,
}) => {
  const formatChange = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}`;
  };

  const getChangeColor = (value: number) => {
    if (value > 0) return 'text-[var(--color-up)]';
    if (value < 0) return 'text-[var(--color-down)]';
    return 'text-[var(--color-text-secondary)]';
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150 group"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-fill-primary)] flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-[var(--color-accent-blue)]" />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            {symbol}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[100px]">
            {name}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium text-[var(--color-text-primary)] tabular-nums">
          {price.toFixed(2)}
        </span>
        <span className={`text-xs font-medium tabular-nums ${getChangeColor(changePercent)}`}>
          {formatChange(changePercent)}%
        </span>
      </div>
    </button>
  );
};
