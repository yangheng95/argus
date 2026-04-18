import type { OHLCV, MACDData, MagicSignal, TimeFrame, IndicatorType, CrosshairData } from './index';

export type { OHLCV, MACDData, MagicSignal, TimeFrame, IndicatorType, CrosshairData };

/** Chart configuration interface */
export interface ChartConfig {
  timeFrame: TimeFrame;
  indicators: IndicatorType[];
  showVolume: boolean;
  showGrid: boolean;
}

/** Moving average data point */
export interface MAData {
  time: number;
  value: number;
}

/** Volume data point */
export interface VolumeData {
  time: number;
  value: number;
  color: 'up' | 'down' | 'neutral';
}

/** Chart data bundle */
export interface ChartData {
  symbol: string;
  candles: OHLCV[];
  ma5?: MAData[];
  ma10?: MAData[];
  ma20?: MAData[];
  ma60?: MAData[];
  macd?: MACDData[];
  signals?: MagicSignal[];
}

/** Tooltip data for chart crosshair */
export interface TooltipData {
  ohlcv: OHLCV;
  ma5?: number;
  ma10?: number;
  ma20?: number;
  macdDif?: number;
  macdDea?: number;
  macdBar?: number;
}

/** Chart theme colors */
export interface ChartTheme {
  background: string;
  grid: string;
  text: string;
  textSecondary: string;
  up: string;
  down: string;
  ma5: string;
  ma10: string;
  ma20: string;
  ma60: string;
  volumeUp: string;
  volumeDown: string;
  crosshair: string;
}
