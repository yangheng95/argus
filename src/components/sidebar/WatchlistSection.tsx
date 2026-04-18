import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StockListItem } from './StockListItem.js';
import { CryptoListItem } from './CryptoListItem.js';

export interface StockItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface CryptoItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface WatchlistSectionProps {
  myListStocks: StockItem[];
  myCryptoItems: CryptoItem[];
  onSelectStock?: (symbol: string) => void;
  onSelectCrypto?: (symbol: string) => void;
}

export const WatchlistSection: React.FC<WatchlistSectionProps> = ({
  myListStocks,
  myCryptoItems,
  onSelectStock,
  onSelectCrypto,
}) => {
  const [myListExpanded, setMyListExpanded] = useState(true);
  const [myCryptoExpanded, setMyCryptoExpanded] = useState(true);

  return (
    <div className="flex flex-col">
      {/* My List Section */}
      <div className="border-b border-[var(--color-separator)]">
        <button
          onClick={() => setMyListExpanded(!myListExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
        >
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            My List
          </span>
          {myListExpanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
          )}
        </button>
        {myListExpanded && (
          <div className="flex flex-col">
            {myListStocks.map((stock) => (
              <StockListItem
                key={stock.symbol}
                symbol={stock.symbol}
                name={stock.name}
                price={stock.price}
                change={stock.change}
                changePercent={stock.changePercent}
                onClick={() => onSelectStock?.(stock.symbol)}
              />
            ))}
          </div>
        )}
      </div>

      {/* My Crypto Section */}
      <div className="border-b border-[var(--color-separator)]">
        <button
          onClick={() => setMyCryptoExpanded(!myCryptoExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
        >
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            My Crypto
          </span>
          {myCryptoExpanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--color-text-secondary)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
          )}
        </button>
        {myCryptoExpanded && (
          <div className="flex flex-col">
            {myCryptoItems.map((crypto) => (
              <CryptoListItem
                key={crypto.symbol}
                symbol={crypto.symbol}
                name={crypto.name}
                price={crypto.price}
                change={crypto.change}
                changePercent={crypto.changePercent}
                onClick={() => onSelectCrypto?.(crypto.symbol)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
