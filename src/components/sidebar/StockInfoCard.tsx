import type { Stock } from '../../types/index.js';

export interface StockInfoCardProps {
  stock: Stock;
  isMarketOpen?: boolean;
}

export const StockInfoCard: React.FC<StockInfoCardProps> = ({ stock, isMarketOpen = true }) => {
  const formatChange = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}`;
  };

  const getChangeColor = (value: number) => {
    if (value > 0) return 'text-[var(--color-up)]';
    if (value < 0) return 'text-[var(--color-down)]';
    return 'text-[var(--color-text-secondary)]';
  };

  const getChangeBgColor = (value: number) => {
    if (value > 0) return 'bg-[var(--color-up-bg)]';
    if (value < 0) return 'bg-[var(--color-down-bg)]';
    return 'bg-[var(--color-fill-primary)]';
  };

  return (
    <div className="p-4 bg-[var(--color-bg-secondary)]">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
              {stock.symbol}
            </h2>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getChangeBgColor(stock.change)} ${getChangeColor(stock.change)}`}>
              {isMarketOpen ? '交易中' : '已收盘'}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {stock.name}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {stock.exchange}
          </p>
        </div>
      </div>

      <div className="flex items-baseline gap-3 mt-3">
        <span className="text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
          {stock.price.toFixed(2)}
        </span>
        <div className="flex items-center gap-1">
          <span className={`text-sm font-medium tabular-nums ${getChangeColor(stock.change)}`}>
            {formatChange(stock.change)}
          </span>
          <span className={`text-sm font-medium tabular-nums ${getChangeColor(stock.changePercent)}`}>
            ({formatChange(stock.changePercent)}%)
          </span>
        </div>
      </div>
    </div>
  );
};
