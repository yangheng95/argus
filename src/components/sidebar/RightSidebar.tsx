import type { Stock, MarketIndex } from '../../types/index.js';
import { MarketOverviewBar } from './MarketOverviewBar.js';
import { WatchlistPanel } from './WatchlistPanel.js';
import { StockItem, CryptoItem } from './WatchlistSection.js';
import { StockDetailTabs } from './StockDetailTabs.js';
import { StockInfoCard } from './StockInfoCard.js';
import { BuySellBar } from './BuySellBar.js';
import { KeyStatistics } from './KeyStatistics.js';

export interface RightSidebarProps {
  selectedStock: Stock;
  indices: MarketIndex[];
  myListStocks: StockItem[];
  myCryptoItems: CryptoItem[];
  buySellData: {
    buyPercent: number;
    sellPercent: number;
    bidPrice: number;
    askPrice: number;
  };
  onSelectStock?: (symbol: string) => void;
  onSelectCrypto?: (symbol: string) => void;
  onClose?: () => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  selectedStock,
  indices,
  myListStocks,
  myCryptoItems,
  buySellData,
  onSelectStock,
  onSelectCrypto,
  onClose,
}) => {
  return (
    <div className="w-[320px] flex-shrink-0 flex flex-col bg-[var(--color-bg-primary)] border-l border-[var(--color-separator)] h-full overflow-y-auto">
      {/* Market Overview Bar */}
      <MarketOverviewBar indices={indices} />

      {/* Watchlist Panel */}
      <WatchlistPanel
        myListStocks={myListStocks}
        myCryptoItems={myCryptoItems}
        onSelectStock={onSelectStock}
        onSelectCrypto={onSelectCrypto}
        onClose={onClose}
      />

      {/* Stock Detail View */}
      <div className="mt-2 border-t border-[var(--color-separator)]">
        <StockInfoCard stock={selectedStock} />
        <StockDetailTabs />
        <BuySellBar
          buyPercent={buySellData.buyPercent}
          sellPercent={buySellData.sellPercent}
          bidPrice={buySellData.bidPrice}
          askPrice={buySellData.askPrice}
        />
        <KeyStatistics stock={selectedStock} />
      </div>
    </div>
  );
};
