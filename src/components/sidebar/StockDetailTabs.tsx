import { useState } from 'react';

type TabType = 'Overview' | 'Analysis' | 'Ticks' | 'Forecast';

export interface StockDetailTabsProps {
  defaultTab?: TabType;
  onTabChange?: (tab: TabType) => void;
}

export const StockDetailTabs: React.FC<StockDetailTabsProps> = ({
  defaultTab = 'Overview',
  onTabChange,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);

  const tabs: TabType[] = ['Overview', 'Analysis', 'Ticks', 'Forecast'];

  const handleTabClick = (tab: TabType) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  return (
    <div className="flex items-center border-b border-[var(--color-separator)]">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => handleTabClick(tab)}
          className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors duration-150 relative
            ${activeTab === tab 
              ? 'text-[var(--color-accent-blue)]' 
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
        >
          {tab}
          {activeTab === tab && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent-blue)]" />
          )}
        </button>
      ))}
    </div>
  );
};
