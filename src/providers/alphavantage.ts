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

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";

const ALPHA_INTERVAL: Record<Interval, string> = {
  "1": "1min",
  "5": "5min",
  "15": "15min",
  "30": "30min",
  "60": "60min",
  D: "daily",
  W: "weekly",
  M: "monthly",
};

function toNumber(value?: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAlphaError(data: Record<string, unknown>): ProviderError {
  const note = typeof data.Note === "string" ? data.Note : undefined;
  const errorMessage =
    typeof data["Error Message"] === "string" ? data["Error Message"] : undefined;
  const information =
    typeof data.Information === "string" ? data.Information : undefined;

  const text = note ?? errorMessage ?? information ?? "Alpha Vantage returned an error.";

  if (note?.toLowerCase().includes("frequency")) {
    return new ProviderError("alphavantage", "RATE_LIMIT", text);
  }
  if (text.toLowerCase().includes("api key")) {
    return new ProviderError("alphavantage", "AUTH", text);
  }
  if (text.toLowerCase().includes("invalid api call")) {
    return new ProviderError("alphavantage", "UPSTREAM", text);
  }
  if (errorMessage) {
    return new ProviderError("alphavantage", "NOT_FOUND", text);
  }

  return new ProviderError("alphavantage", "UPSTREAM", text);
}

function parseSeriesEntry(
  timestamp: string,
  values: Record<string, string>,
): NormalizedCandle | null {
  const seconds = Math.floor(new Date(timestamp).getTime() / 1000);
  if (!Number.isFinite(seconds)) {
    return null;
  }

  const open = toNumber(values["1. open"]);
  const high = toNumber(values["2. high"]);
  const low = toNumber(values["3. low"]);
  const close = toNumber(values["4. close"]);
  const volume = toNumber(values["5. volume"]) ?? toNumber(values["6. volume"]) ?? 0;

  if (
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined
  ) {
    return null;
  }

  return {
    timestamp: seconds,
    open,
    high,
    low,
    close,
    volume,
  };
}

export class AlphaVantageClient {
  constructor(private readonly apiKey: string) {}

  private async request(
    params: Record<string, string | number | undefined>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(ALPHA_VANTAGE_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("apikey", this.apiKey);

    const data = await fetchJson<Record<string, unknown>>(url.toString(), {
      provider: "alphavantage",
    });

    if (data.Note || data["Error Message"] || data.Information) {
      throw parseAlphaError(data);
    }

    return data;
  }

  async getQuote(symbol: string): Promise<NormalizedQuote | null> {
    const data = await this.request({
      function: "GLOBAL_QUOTE",
      symbol,
    });

    const quote = data["Global Quote"] as Record<string, string> | undefined;
    if (!quote) {
      return null;
    }

    const price = toNumber(quote["05. price"]);
    if (price === undefined || price <= 0) {
      return null;
    }

    return {
      symbol,
      price,
      change: toNumber(quote["09. change"]) ?? 0,
      percentChange: toNumber((quote["10. change percent"] ?? "0").replace("%", "")) ?? 0,
      high: toNumber(quote["03. high"]) ?? price,
      low: toNumber(quote["04. low"]) ?? price,
      open: toNumber(quote["02. open"]) ?? price,
      previousClose: toNumber(quote["08. previous close"]) ?? price,
      source: "alphavantage",
    };
  }

  async getCompanyProfile(symbol: string): Promise<NormalizedCompanyProfile | null> {
    const data = await this.request({
      function: "OVERVIEW",
      symbol,
    });

    if (!data.Symbol) {
      return null;
    }

    return {
      symbol,
      name: data.Name as string | undefined,
      exchange: data.Exchange as string | undefined,
      currency: data.Currency as string | undefined,
      country: data.Country as string | undefined,
      industry: data.Industry as string | undefined,
      ipo: data.LatestQuarter as string | undefined,
      marketCapitalization: toNumber(data.MarketCapitalization as string | undefined),
      website: data.OfficialSite as string | undefined,
      source: "alphavantage",
    };
  }

  async getCandles(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
  ): Promise<NormalizedCandle[] | null> {
    const alphaInterval = ALPHA_INTERVAL[interval];

    let fn = "";
    let seriesKey = "";
    const params: Record<string, string | number | undefined> = {
      symbol,
      outputsize: "full",
    };

    if (["1", "5", "15", "30", "60"].includes(interval)) {
      fn = "TIME_SERIES_INTRADAY";
      params.interval = alphaInterval;
      seriesKey = `Time Series (${alphaInterval})`;
    } else if (interval === "D") {
      fn = "TIME_SERIES_DAILY";
      seriesKey = "Time Series (Daily)";
    } else if (interval === "W") {
      fn = "TIME_SERIES_WEEKLY";
      seriesKey = "Weekly Time Series";
    } else {
      fn = "TIME_SERIES_MONTHLY";
      seriesKey = "Monthly Time Series";
    }

    params.function = fn;
    const data = await this.request(params);
    const series = data[seriesKey] as Record<string, Record<string, string>> | undefined;
    if (!series) {
      return null;
    }

    return Object.entries(series)
      .map(([timestamp, values]) => parseSeriesEntry(timestamp, values))
      .filter((item): item is NormalizedCandle => item !== null)
      .filter((item) => item.timestamp >= from && item.timestamp <= to)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getNews(symbol: string, limit: number): Promise<NormalizedNewsItem[] | null> {
    const data = await this.request({
      function: "NEWS_SENTIMENT",
      tickers: symbol,
      limit,
      sort: "LATEST",
    });

    const feed = data.feed as Array<Record<string, unknown>> | undefined;
    if (!feed?.length) {
      return null;
    }

    return feed.map((item) => ({
      headline: (item.title as string | undefined) ?? "Untitled",
      summary: item.summary as string | undefined,
      url: item.url as string | undefined,
      source: item.source as string | undefined,
      datetime:
        typeof item.time_published === "string"
          ? Math.floor(new Date(item.time_published).getTime() / 1000)
          : undefined,
    }));
  }

  async getRsi(
    symbol: string,
    interval: Interval,
    period: number,
  ): Promise<NormalizedRsiPoint[] | null> {
    const data = await this.request({
      function: "RSI",
      symbol,
      interval: ALPHA_INTERVAL[interval],
      time_period: period,
      series_type: "close",
    });

    const rsiData = data["Technical Analysis: RSI"] as
      | Record<string, { RSI?: string }>
      | undefined;
    if (!rsiData) {
      return null;
    }

    return Object.entries(rsiData)
      .map(([timestamp, values]) => ({
        timestamp: Math.floor(new Date(timestamp).getTime() / 1000),
        value: toNumber(values.RSI),
      }))
      .filter((point): point is NormalizedRsiPoint => typeof point.value === "number")
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getMacd(symbol: string, interval: Interval): Promise<NormalizedMacdPoint[] | null> {
    const data = await this.request({
      function: "MACD",
      symbol,
      interval: ALPHA_INTERVAL[interval],
      series_type: "close",
    });

    const macdData = data["Technical Analysis: MACD"] as
      | Record<string, { MACD?: string; MACD_Hist?: string; MACD_Signal?: string }>
      | undefined;
    if (!macdData) {
      return null;
    }

    return Object.entries(macdData)
      .map(([timestamp, values]) => ({
        timestamp: Math.floor(new Date(timestamp).getTime() / 1000),
        macd: toNumber(values.MACD),
        signal: toNumber(values.MACD_Signal),
        histogram: toNumber(values.MACD_Hist) ?? 0,
      }))
      .filter(
        (point): point is NormalizedMacdPoint =>
          typeof point.macd === "number" && typeof point.signal === "number",
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getKeyFinancials(symbol: string): Promise<NormalizedKeyFinancials | null> {
    const data = await this.request({
      function: "OVERVIEW",
      symbol,
    });

    if (!data.Symbol) {
      return null;
    }

    return {
      symbol,
      peRatio: toNumber(data.PERatio as string | undefined),
      eps: toNumber(data.EPS as string | undefined),
      bookValue: toNumber(data.BookValue as string | undefined),
      dividendYield: toNumber(data.DividendYield as string | undefined),
      week52High: toNumber(data["52WeekHigh"] as string | undefined),
      week52Low: toNumber(data["52WeekLow"] as string | undefined),
      marketCapitalization: toNumber(data.MarketCapitalization as string | undefined),
      beta: toNumber(data.Beta as string | undefined),
      source: "alphavantage",
    };
  }
}

