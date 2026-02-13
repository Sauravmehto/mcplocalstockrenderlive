import "dotenv/config";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  formatResponse,
  lineDate,
  lineMoney,
  lineNumber,
  linePercent,
} from "./lib/formatters.js";
import {
  calculateMacdFromCandles,
  calculateRsiFromCandles,
} from "./lib/indicators.js";
import { AlphaVantageClient } from "./providers/alphavantage.js";
import { FinnhubClient } from "./providers/finnhub.js";
import { ProviderError } from "./providers/http.js";
import {
  Interval,
  NormalizedCandle,
  NormalizedMacdPoint,
  NormalizedNewsItem,
  NormalizedRsiPoint,
} from "./providers/types.js";

const server = new McpServer({
  name: "local-stock-analyst",
  version: "1.0.0",
});

const symbolSchema = z
  .string()
  .min(1)
  .max(10)
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(value), {
    message: "Symbol must be 1-10 chars: A-Z, 0-9, dot, hyphen.",
  });

const intervalSchema = z.enum(["1", "5", "15", "30", "60", "D", "W", "M"]);

const unixFromSchema = z.number().int().positive();
const unixToSchema = z.number().int().positive();

const rangeSchema = z
  .object({
    from: unixFromSchema,
    to: unixToSchema,
  })
  .refine((value) => value.from < value.to, {
    message: "`from` must be less than `to`.",
  })
  .refine((value) => value.to - value.from <= 60 * 60 * 24 * 365 * 5, {
    message: "Date window is too large. Maximum range is 5 years.",
  });

const newsFromSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const newsToSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const newsLimitSchema = z.number().int().min(1).max(50).default(10);

const newsRangeSchema = z
  .object({
    from: newsFromSchema,
    to: newsToSchema,
    limit: newsLimitSchema,
  })
  .refine((value) => value.from <= value.to, {
    message: "`from` must be before or equal to `to`.",
  });

const finnhubClient = process.env.FINNHUB_API_KEY
  ? new FinnhubClient(process.env.FINNHUB_API_KEY)
  : null;

const alphaVantageClient = process.env.ALPHAVANTAGE_API_KEY
  ? new AlphaVantageClient(process.env.ALPHAVANTAGE_API_KEY)
  : null;

function textResponse(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

function toUserErrorMessage(
  tool: string,
  errors: ProviderError[],
  hadNoData = false,
): string {
  const hasRateLimit = errors.some((error) => error.code === "RATE_LIMIT");
  const hasAuth = errors.some((error) => error.code === "AUTH");
  const hasNotFound = errors.some((error) => error.code === "NOT_FOUND");

  if (hasRateLimit) {
    return `${tool} failed: provider rate limit reached. Try again shortly or add higher-tier API keys.`;
  }
  if (hasAuth) {
    return `${tool} failed: missing or invalid API key. Check FINNHUB_API_KEY and ALPHAVANTAGE_API_KEY.`;
  }
  if (hasNotFound || hadNoData) {
    return `${tool} failed: symbol may be unsupported or unavailable for this request window.`;
  }
  return `${tool} failed due to provider/network errors. Try again in a moment.`;
}

async function executeWithFallback<T>(args: {
  toolName: string;
  primary?: () => Promise<T | null>;
  fallback?: () => Promise<T | null>;
}): Promise<{ data: T | null; source?: string; warning?: string; error?: string }> {
  const errors: ProviderError[] = [];
  let primaryNoData = false;

  if (args.primary) {
    try {
      const data = await args.primary();
      if (data) {
        return { data, source: "Finnhub" };
      }
      primaryNoData = true;
    } catch (error) {
      if (error instanceof ProviderError) {
        errors.push(error);
      }
    }
  }

  if (args.fallback) {
    try {
      const data = await args.fallback();
      if (data) {
        return {
          data,
          source: "Alpha Vantage",
          warning: errors.length
            ? "Used fallback provider due to primary provider error."
            : primaryNoData
              ? "Used fallback provider because primary returned no data."
              : undefined,
        };
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        errors.push(error);
      }
    }
  }

  return {
    data: null,
    error: toUserErrorMessage(args.toolName, errors, primaryNoData),
  };
}

function latest<T>(items: T[]): T | null {
  if (!items.length) {
    return null;
  }
  return items[items.length - 1];
}

function formatCandles(candles: NormalizedCandle[], limit: number): string[] {
  const selected = candles.slice(-Math.min(limit, candles.length));
  return selected.map(
    (candle) =>
      `${new Date(candle.timestamp * 1000).toISOString()} | O ${candle.open.toFixed(2)} | H ${candle.high.toFixed(2)} | L ${candle.low.toFixed(2)} | C ${candle.close.toFixed(2)} | V ${Math.round(candle.volume)}`,
  );
}

function formatNews(news: NormalizedNewsItem[]): string[] {
  return news.map((item, index) => {
    const date = item.datetime
      ? new Date(item.datetime * 1000).toISOString()
      : "unknown-date";
    const source = item.source ?? "unknown-source";
    const link = item.url ? ` (${item.url})` : "";
    return `${index + 1}. [${date}] ${item.headline} - ${source}${link}`;
  });
}

function formatRsiSummary(points: NormalizedRsiPoint[]): string[] {
  const point = latest(points);
  if (!point) {
    return ["No RSI datapoint returned."];
  }
  const value = point.value;
  let zone = "neutral";
  if (value >= 70) {
    zone = "overbought";
  } else if (value <= 30) {
    zone = "oversold";
  }
  return [lineNumber("Latest RSI", value, 2), `Signal zone: ${zone}`, lineDate("Timestamp", point.timestamp)];
}

function formatMacdSummary(points: NormalizedMacdPoint[]): string[] {
  const point = latest(points);
  if (!point) {
    return ["No MACD datapoint returned."];
  }
  const momentum = point.histogram > 0 ? "bullish" : point.histogram < 0 ? "bearish" : "neutral";
  return [
    lineNumber("MACD", point.macd, 4),
    lineNumber("Signal", point.signal, 4),
    lineNumber("Histogram", point.histogram, 4),
    `Momentum: ${momentum}`,
    lineDate("Timestamp", point.timestamp),
  ];
}

server.registerTool(
  "get_stock_price",
  {
    description: "Get latest traded stock price for a ticker symbol.",
    inputSchema: {
      symbol: symbolSchema.describe("Ticker symbol, e.g. AAPL, MSFT, TSLA."),
    },
  },
  async ({ symbol }) => {
    const result = await executeWithFallback({
      toolName: "get_stock_price",
      primary: finnhubClient ? () => finnhubClient.getQuote(symbol) : undefined,
      fallback: alphaVantageClient ? () => alphaVantageClient.getQuote(symbol) : undefined,
    });

    if (!result.data) {
      return textResponse(result.error ?? "No data", true);
    }

    return textResponse(
      formatResponse({
        title: `Latest price for ${symbol}`,
        source: result.source,
        warning: result.warning,
        lines: [
          lineMoney("Price", result.data.price),
          lineMoney("Change", result.data.change),
          linePercent("Change %", result.data.percentChange),
          lineDate("Timestamp", result.data.timestamp),
        ],
      }),
    );
  },
);

server.registerTool(
  "get_quote",
  {
    description: "Get extended quote fields including open, high, low, and previous close.",
    inputSchema: {
      symbol: symbolSchema,
    },
  },
  async ({ symbol }) => {
    const result = await executeWithFallback({
      toolName: "get_quote",
      primary: finnhubClient ? () => finnhubClient.getQuote(symbol) : undefined,
      fallback: alphaVantageClient ? () => alphaVantageClient.getQuote(symbol) : undefined,
    });

    if (!result.data) {
      return textResponse(result.error ?? "No data", true);
    }

    return textResponse(
      formatResponse({
        title: `Quote for ${symbol}`,
        source: result.source,
        warning: result.warning,
        lines: [
          lineMoney("Price", result.data.price),
          lineMoney("Open", result.data.open),
          lineMoney("High", result.data.high),
          lineMoney("Low", result.data.low),
          lineMoney("Previous Close", result.data.previousClose),
          lineMoney("Change", result.data.change),
          linePercent("Change %", result.data.percentChange),
          lineDate("Timestamp", result.data.timestamp),
        ],
      }),
    );
  },
);

server.registerTool(
  "get_company_profile",
  {
    description: "Get company profile details for a ticker.",
    inputSchema: {
      symbol: symbolSchema,
    },
  },
  async ({ symbol }) => {
    const result = await executeWithFallback({
      toolName: "get_company_profile",
      primary: finnhubClient ? () => finnhubClient.getCompanyProfile(symbol) : undefined,
      fallback: alphaVantageClient
        ? () => alphaVantageClient.getCompanyProfile(symbol)
        : undefined,
    });

    if (!result.data) {
      return textResponse(result.error ?? "No data", true);
    }

    return textResponse(  
      formatResponse({
        title: `Company profile for ${symbol}`,
        source: result.source,
        warning: result.warning,
        lines: [
          `Name: ${result.data.name ?? "n/a"}`,
          `Exchange: ${result.data.exchange ?? "n/a"}`,
          `Industry: ${result.data.industry ?? "n/a"}`,
          `Country: ${result.data.country ?? "n/a"}`,
          `Currency: ${result.data.currency ?? "n/a"}`,
          `IPO: ${result.data.ipo ?? "n/a"}`,
          lineMoney("Market Cap (M)", result.data.marketCapitalization),
          `Website: ${result.data.website ?? "n/a"}`,
        ],
      }),
    );
  },
);

server.registerTool(
  "get_candles",
  {
    description: "Get OHLCV candles for a symbol within a unix timestamp range.",
    inputSchema: {
      symbol: symbolSchema,
      interval: intervalSchema.describe("One of 1,5,15,30,60,D,W,M"),
      from: unixFromSchema.describe("Unix seconds start time."),
      to: unixToSchema.describe("Unix seconds end time."),
      limit: z.number().int().min(1).max(200).default(20),
    },
  },
  async ({ symbol, interval, from, to, limit }) => {
    const result = await executeWithFallback({
      toolName: "get_candles",
      primary: finnhubClient
        ? () => finnhubClient.getCandles(symbol, interval as Interval, from, to)
        : undefined,
      fallback: alphaVantageClient
        ? () => alphaVantageClient.getCandles(symbol, interval as Interval, from, to)
        : undefined,
    });

    if (!result.data?.length) {
      return textResponse(result.error ?? "No candles returned for this range.", true);
    }

    return textResponse(
      formatResponse({
        title: `Candles for ${symbol} (${interval})`,
        source: result.source,
        warning: result.warning,
        lines: [`Returned candles: ${result.data.length}`, ...formatCandles(result.data, limit)],
      }),
    );
  },
);

server.registerTool(
  "get_stock_news",
  {
    description: "Get stock news headlines within a date window (YYYY-MM-DD).",
    inputSchema: {
      symbol: symbolSchema,
      from: newsFromSchema,
      to: newsToSchema,
      limit: newsLimitSchema,
    },
  },
  async ({ symbol, from, to, limit }) => {
    const result = await executeWithFallback({
      toolName: "get_stock_news",
      primary: finnhubClient ? () => finnhubClient.getNews(symbol, from, to, limit) : undefined,
      fallback: alphaVantageClient ? () => alphaVantageClient.getNews(symbol, limit) : undefined,
    });

    if (!result.data?.length) {
      return textResponse(result.error ?? "No news found.", true);
    }

    return textResponse(
      formatResponse({
        title: `Stock news for ${symbol}`,
        source: result.source,
        warning: result.warning,
        lines: formatNews(result.data),
      }),
    );
  },
);

server.registerTool(
  "get_rsi",
  {
    description:
      "Get RSI (Relative Strength Index). Uses provider RSI when available, otherwise computes from candles.",
    inputSchema: {
      symbol: symbolSchema,
      interval: intervalSchema,
      from: unixFromSchema,
      to: unixToSchema,
      period: z.number().int().min(2).max(100).default(14),
    },
  },
  async ({ symbol, interval, from, to, period }) => {
    const providerResult = await executeWithFallback({
      toolName: "get_rsi",
      primary: finnhubClient
        ? () => finnhubClient.getRsi(symbol, interval as Interval, from, to, period)
        : undefined,
      fallback: alphaVantageClient
        ? () => alphaVantageClient.getRsi(symbol, interval as Interval, period)
        : undefined,
    });

    let rsiPoints = providerResult.data ?? [];
    let source = providerResult.source;
    let warning = providerResult.warning;

    if (!rsiPoints.length) {
      const candlesResult = await executeWithFallback({
        toolName: "get_rsi(candle-fallback)",
        primary: finnhubClient
          ? () => finnhubClient.getCandles(symbol, interval as Interval, from, to)
          : undefined,
        fallback: alphaVantageClient
          ? () => alphaVantageClient.getCandles(symbol, interval as Interval, from, to)
          : undefined,
      });

      if (!candlesResult.data?.length) {
        return textResponse(
          providerResult.error ?? candlesResult.error ?? "Could not compute RSI.",
          true,
        );
      }

      rsiPoints = calculateRsiFromCandles(candlesResult.data, period);
      source = `${candlesResult.source ?? "provider"} + local RSI calculation`;
      warning = "Provider RSI unavailable; computed RSI from candle closes.";
    }

    return textResponse(
      formatResponse({
        title: `RSI for ${symbol}`,
        source,
        warning,
        lines: formatRsiSummary(rsiPoints),
      }),
    );
  },
);

server.registerTool(
  "get_macd",
  {
    description:
      "Get MACD indicator values. Uses provider MACD when available, otherwise computes from candles.",
    inputSchema: {
      symbol: symbolSchema,
      interval: intervalSchema,
      from: unixFromSchema,
      to: unixToSchema,
      fastPeriod: z.number().int().min(2).max(50).default(12),
      slowPeriod: z.number().int().min(3).max(100).default(26),
      signalPeriod: z.number().int().min(2).max(50).default(9),
    },
  },
  async ({ symbol, interval, from, to, fastPeriod, slowPeriod, signalPeriod }) => {
    if (fastPeriod >= slowPeriod) {
      return textResponse("Validation failed: fastPeriod must be smaller than slowPeriod.", true);
    }

    const providerResult = await executeWithFallback({
      toolName: "get_macd",
      primary: finnhubClient
        ? () =>
            finnhubClient.getMacd(
              symbol,
              interval as Interval,
              from,
              to,
              fastPeriod,
              slowPeriod,
              signalPeriod,
            )
        : undefined,
      fallback: alphaVantageClient
        ? () => alphaVantageClient.getMacd(symbol, interval as Interval)
        : undefined,
    });

    let macdPoints = providerResult.data ?? [];
    let source = providerResult.source;
    let warning = providerResult.warning;

    if (!macdPoints.length) {
      const candlesResult = await executeWithFallback({
        toolName: "get_macd(candle-fallback)",
        primary: finnhubClient
          ? () => finnhubClient.getCandles(symbol, interval as Interval, from, to)
          : undefined,
        fallback: alphaVantageClient
          ? () => alphaVantageClient.getCandles(symbol, interval as Interval, from, to)
          : undefined,
      });

      if (!candlesResult.data?.length) {
        return textResponse(
          providerResult.error ?? candlesResult.error ?? "Could not compute MACD.",
          true,
        );
      }

      macdPoints = calculateMacdFromCandles(
        candlesResult.data,
        fastPeriod,
        slowPeriod,
        signalPeriod,
      );
      source = `${candlesResult.source ?? "provider"} + local MACD calculation`;
      warning = "Provider MACD unavailable; computed MACD from candle closes.";
    }

    return textResponse(
      formatResponse({
        title: `MACD for ${symbol}`,
        source,
        warning,
        lines: formatMacdSummary(macdPoints),
      }),
    );
  },
);

server.registerTool(
  "get_key_financials",
  {
    description: "Get key financial metrics for a ticker.",
    inputSchema: {
      symbol: symbolSchema,
    },
  },
  async ({ symbol }) => {
    const result = await executeWithFallback({
      toolName: "get_key_financials",
      primary: finnhubClient ? () => finnhubClient.getKeyFinancials(symbol) : undefined,
      fallback: alphaVantageClient
        ? () => alphaVantageClient.getKeyFinancials(symbol)
        : undefined,
    });

    if (!result.data) {
      return textResponse(result.error ?? "No data", true);
    }

    return textResponse(
      formatResponse({
        title: `Key financials for ${symbol}`,
        source: result.source,
        warning: result.warning,
        lines: [
          lineNumber("P/E", result.data.peRatio),
          lineNumber("EPS", result.data.eps),
          lineNumber("Book Value", result.data.bookValue),
          linePercent("Dividend Yield", result.data.dividendYield),
          lineMoney("52W High", result.data.week52High),
          lineMoney("52W Low", result.data.week52Low),
          lineMoney("Market Cap", result.data.marketCapitalization),
          lineNumber("Beta", result.data.beta),
        ],
      }),
    );
  },
);

async function main() {
  if (!finnhubClient && !alphaVantageClient) {
    console.error(
      "Warning: no API keys detected. Set FINNHUB_API_KEY and/or ALPHAVANTAGE_API_KEY.",
    );
  }

  const isRenderEnvironment =
    process.env.RENDER === "true" || Boolean(process.env.RENDER_EXTERNAL_URL);
  const transportMode = (process.env.MCP_TRANSPORT ?? (isRenderEnvironment ? "http" : "stdio"))
    .toLowerCase();

  if (transportMode === "http" || transportMode === "streamable-http") {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("PORT must be a positive number in HTTP mode.");
    }

    const transport = new StreamableHTTPServerTransport({
      // Stateless mode keeps deployment simple behind Render.
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (requestUrl.pathname === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (requestUrl.pathname === "/mcp") {
        await transport.handleRequest(req, res);
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(port, resolve);
    });

    console.error(`Local Stock Analyst MCP server running on HTTP at :${port} (/mcp)`);
    return;
  }

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error("Local Stock Analyst MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});