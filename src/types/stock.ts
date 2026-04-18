import type { Stock, Exchange, StockQuote } from './index';

export type { Stock, Exchange, StockQuote };

/** Stock symbol type alias */
export type StockSymbol = string;

/** Stock with extended quote information */
export interface StockWithQuote extends Stock {
  quote: StockQuote;
  lastUpdate: number;
}

/** Portfolio position */
export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

/** Order types */
export type OrderType = 'market' | 'limit' | 'stop';

/** Order status */
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';

/** Order entity */
export interface Order {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  orderType: OrderType;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

/** User account */
export interface Account {
  userId: string;
  balance: number;
  availableBalance: number;
  frozenBalance: number;
  positions: Position[];
  createdAt: number;
}
