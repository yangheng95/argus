/** TimeFrame for chart data selection */
export type TimeFrame = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'YTD';

/** Stock entity with full market data */
export interface Stock {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  peRatio?: number;
  dayRange: { low: number; high: number };
  week52Range: { low: number; high: number };
  avgVolume?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
}

/** OHLCV candlestick data point */
export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Market index data */
export interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

/** Watchlist item with user-specific data */
export interface WatchlistItem {
  symbol: string;
  addedAt: number;
  notes?: string;
  alertPrice?: number;
}

/** MACD indicator data */
export interface MACDData {
  time: number;
  dif: number;
  dea: number;
  bar: number;
}

/** Magic signal for trading decisions */
export interface MagicSignal {
  time: number;
  type: 'buy' | 'sell' | 'neutral';
  strength: number;
  message?: string;
}

/** Trade/Order entity */
export interface Trade {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  price: number;
  quantity: number;
  timestamp: number;
}

/** Exchange type for stocks */
export type Exchange = 'NYSE' | 'NASDAQ' | 'AMEX' | 'SSE' | 'SZSE' | 'HKEX';

/** Stock quote for real-time updates */
export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: number;
}

/** Stock overview for summary display */
export interface StockOverview {
  symbol: string;
  name: string;
  exchange: Exchange;
  price: number;
  changePercent: number;
}

/** Chart configuration */
export interface ChartConfig {
  timeFrame: TimeFrame;
  indicators: string[];
  showVolume: boolean;
}

/** Indicator type for charts */
export type IndicatorType = 'MA5' | 'MA10' | 'MA20' | 'MA60' | 'MACD' | 'MagicSignal' | 'Volume';

/** Crosshair data for tooltip positioning */
export interface CrosshairData {
  x: number;
  y: number;
  price: number;
  time: number;
  data?: OHLCV;
}
