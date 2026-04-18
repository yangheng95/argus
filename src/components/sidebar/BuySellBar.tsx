export interface BuySellBarProps {
  buyPercent: number;
  sellPercent: number;
  bidPrice: number;
  askPrice: number;
}

export const BuySellBar: React.FC<BuySellBarProps> = ({
  buyPercent,
  sellPercent,
  bidPrice,
  askPrice,
}) => {
  const total = buyPercent + sellPercent;
  const normalizedBuy = total > 0 ? (buyPercent / total) * 100 : 50;
  const normalizedSell = total > 0 ? (sellPercent / total) * 100 : 50;

  return (
    <div className="p-4 bg-[var(--color-bg-secondary)]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-up)]">BUY</span>
          <span className="text-xs font-bold text-[var(--color-text-primary)] tabular-nums">
            {buyPercent.toFixed(0)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[var(--color-text-primary)] tabular-nums">
            {sellPercent.toFixed(0)}%
          </span>
          <span className="text-xs font-medium text-[var(--color-down)]">SELL</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2 rounded-full overflow-hidden flex bg-[var(--color-fill-primary)]">
        <div
          className="h-full bg-[var(--color-up)] transition-all duration-300"
          style={{ width: `${normalizedBuy}%` }}
        />
        <div
          className="h-full bg-[var(--color-down)] transition-all duration-300"
          style={{ width: `${normalizedSell}%` }}
        />
      </div>

      {/* Bid/Ask Prices */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-separator)]">
        <div className="flex flex-col">
          <span className="text-xs text-[var(--color-text-tertiary)]">Bid</span>
          <span className="text-sm font-medium text-[var(--color-down)] tabular-nums">
            {bidPrice.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-[var(--color-text-tertiary)]">Ask</span>
          <span className="text-sm font-medium text-[var(--color-up)] tabular-nums">
            {askPrice.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
};
