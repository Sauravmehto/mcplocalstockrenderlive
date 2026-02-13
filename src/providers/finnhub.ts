import { fetchJson, ProviderError } from "./http.js";
import {
  Interval,
  NormalizedCandle,
  NormalizedCompanyProfile,
  NormalizedKeyFinancials,
  NormalizedMacdPoint,
  NormalizedNewsItem,
  NormalizedQuote,
  NormalizedRsiPoint,
} from "./types.js";

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

const FINNHUB_RESOLUTION: Record<Interval, string> = {
  "1": "1",
  "5": "5",
  "15": "15",
  "30": "30",
  "60": "60",
  D: "D",
  W: "W",
  M: "M",
};

export class FinnhubClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(
    endpoint: string,
    query: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${FINNHUB_BASE_URL}${endpoint}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("token", this.apiKey);

    const data = await fetchJson<T & { error?: string }>(url.toString(), {
      provider: "finnhub",
    });

    if (data && typeof data === "object" && "error" in data && data.error) {
      const errorText = String(data.error).toLowerCase();
      if (errorText.includes("limit")) {
        throw new ProviderError("finnhub", "RATE_LIMIT", String(data.error));
      }
      if (errorText.includes("token") || errorText.includes("auth")) {
        throw new ProviderError("finnhub", "AUTH", String(data.error));
      }
      throw new ProviderError("finnhub", "UPSTREAM", String(data.error));
    }

    return data;
  }

  async getQuote(symbol: string): Promise<NormalizedQuote | null> {
    const data = await this.request<{
      c?: number;
      d?: number;
      dp?: number;
      h?: number;
      l?: number;
      o?: number;
      pc?: number;
      t?: number;
    }>("/quote", { symbol });

    if (!data.c || data.c <= 0) {
      return null;
    }

    return {
      symbol,
      price: data.c,
      change: data.d ?? 0,
      percentChange: data.dp ?? 0,
      high: data.h ?? data.c,
      low: data.l ?? data.c,
      open: data.o ?? data.c,
      previousClose: data.pc ?? data.c,
      timestamp: data.t,
      source: "finnhub",
    };
  }

  async getCompanyProfile(symbol: string): Promise<NormalizedCompanyProfile | null> {
    const data = await this.request<{
      ticker?: string;
      name?: string;
      exchange?: string;
      currency?: string;
      country?: string;
      finnhubIndustry?: string;
      ipo?: string;
      marketCapitalization?: number;
      weburl?: string;
      logo?: string;
    }>("/stock/profile2", { symbol });

    if (!data.ticker) {
      return null;
    }

    return {
      symbol,
      name: data.name,
      exchange: data.exchange,
      currency: data.currency,
      country: data.country,
      industry: data.finnhubIndustry,
      ipo: data.ipo,
      marketCapitalization: data.marketCapitalization,
      website: data.weburl,
      logo: data.logo,
      source: "finnhub",
    };
  }

  async getCandles(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
  ): Promise<NormalizedCandle[] | null> {
    const data = await this.request<{
      c?: number[];
      h?: number[];
      l?: number[];
      o?: number[];
      t?: number[];
      v?: number[];
      s?: string;
    }>("/stock/candle", {
      symbol,
      resolution: FINNHUB_RESOLUTION[interval],
      from,
      to,
    });

    if (!data.s || data.s !== "ok" || !data.t?.length) {
      return null;
    }

    return data.t.map((timestamp, index) => ({
      timestamp,
      open: data.o?.[index] ?? 0,
      high: data.h?.[index] ?? 0,
      low: data.l?.[index] ?? 0,
      close: data.c?.[index] ?? 0,
      volume: data.v?.[index] ?? 0,
    }));
  }

  async getNews(
    symbol: string,
    from: string,
    to: string,
    limit: number,
  ): Promise<NormalizedNewsItem[] | null> {
    const data = await this.request<
      Array<{
        headline?: string;
        summary?: string;
        url?: string;
        source?: string;
        datetime?: number;
      }>
    >("/company-news", { symbol, from, to });

    const news = (data ?? []).filter((item) => item.headline).slice(0, limit);
    if (!news.length) {
      return null;
    }

    return news.map((item) => ({
      headline: item.headline ?? "Untitled",
      summary: item.summary,
      url: item.url,
      source: item.source,
      datetime: item.datetime,
    }));
  }

  async getRsi(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
    period: number,
  ): Promise<NormalizedRsiPoint[] | null> {
    const data = await this.request<{
      s?: string;
      t?: number[];
      rsi?: number[];
    }>("/indicator", {
      symbol,
      resolution: FINNHUB_RESOLUTION[interval],
      from,
      to,
      indicator: "rsi",
      timeperiod: period,
    });

    if (data.s !== "ok" || !data.t?.length || !data.rsi?.length) {
      return null;
    }

    return data.t
      .map((timestamp, index) => ({
        timestamp,
        value: data.rsi?.[index],
      }))
      .filter((point): point is NormalizedRsiPoint => typeof point.value === "number");
  }

  async getMacd(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
  ): Promise<NormalizedMacdPoint[] | null> {
    const data = await this.request<{
      s?: string;
      t?: number[];
      macd?: number[];
      signal?: number[];
      histogram?: number[];
    }>("/indicator", {
      symbol,
      resolution: FINNHUB_RESOLUTION[interval],
      from,
      to,
      indicator: "macd",
      fastperiod: fastPeriod,
      slowperiod: slowPeriod,
      signalperiod: signalPeriod,
    });

    if (data.s !== "ok" || !data.t?.length || !data.macd?.length || !data.signal?.length) {
      return null;
    }

    return data.t
      .map((timestamp, index) => ({
        timestamp,
        macd: data.macd?.[index],
        signal: data.signal?.[index],
        histogram: data.histogram?.[index] ?? 0,
      }))
      .filter(
        (point): point is NormalizedMacdPoint =>
          typeof point.macd === "number" && typeof point.signal === "number",
      );
  }

  async getKeyFinancials(symbol: string): Promise<NormalizedKeyFinancials | null> {
    const data = await this.request<{
      metric?: Record<string, number | undefined>;
    }>("/stock/metric", {
      symbol,
      metric: "all",
    });

    if (!data.metric) {
      return null;
    }

    return {
      symbol,
      peRatio: data.metric.peBasicExclExtraTTM,
      eps: data.metric.epsBasicExclExtraItemsTTM,
      bookValue: data.metric.bookValuePerShareQuarterly,
      dividendYield: data.metric.dividendYieldIndicatedAnnual,
      week52High: data.metric["52WeekHigh"],
      week52Low: data.metric["52WeekLow"],
      marketCapitalization: data.metric.marketCapitalization,
      beta: data.metric.beta,
      source: "finnhub",
    };
  }
}

