export type ProviderName = "finnhub" | "alphavantage";

export type Interval = "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M";

export interface NormalizedQuote {
  symbol: string;
  price: number;
  change: number;
  percentChange: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  timestamp?: number;
  source: ProviderName;
}

export interface NormalizedCompanyProfile {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  country?: string;
  industry?: string;
  ipo?: string;
  marketCapitalization?: number;
  website?: string;
  logo?: string;
  source: ProviderName;
}

export interface NormalizedCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizedNewsItem {
  headline: string;
  summary?: string;
  url?: string;
  source?: string;
  datetime?: number;
}

export interface NormalizedRsiPoint {
  timestamp: number;
  value: number;
}

export interface NormalizedMacdPoint {
  timestamp: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface NormalizedKeyFinancials {
  symbol: string;
  peRatio?: number;
  eps?: number;
  bookValue?: number;
  dividendYield?: number;
  week52High?: number;
  week52Low?: number;
  marketCapitalization?: number;
  beta?: number;
  source: ProviderName;
}

