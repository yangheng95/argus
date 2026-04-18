import { X } from 'lucide-react';
import { WatchlistSection, StockItem, CryptoItem } from './WatchlistSection.js';

export interface WatchlistPanelProps {
  myListStocks: StockItem[];
  myCryptoItems: CryptoItem[];
  onSelectStock?: (symbol: string) => void;
  onSelectCrypto?: (symbol: string) => void;
  onClose?: () => void;
}

export const WatchlistPanel: React.FC<WatchlistPanelProps> = ({
  myListStocks,
  myCryptoItems,
  onSelectStock,
  onSelectCrypto,
  onClose,
}) => {
  return (
    <div className="flex flex-col bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-separator)]">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Watchlist
        </h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors duration-150"
          aria-label="Close watchlist"
        >
          <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
        </button>
      </div>

      {/* Watchlist Sections */}
      <WatchlistSection
        myListStocks={myListStocks}
        myCryptoItems={myCryptoItems}
        onSelectStock={onSelectStock}
        onSelectCrypto={onSelectCrypto}
      />
    </div>
  );
};
