import { fetchJson, ProviderError } from "./http.js";
const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const ALPHA_INTERVAL = {
    "1": "1min",
    "5": "5min",
    "15": "15min",
    "30": "30min",
    "60": "60min",
    D: "daily",
    W: "weekly",
    M: "monthly",
};
function toNumber(value) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseAlphaError(data) {
    const note = typeof data.Note === "string" ? data.Note : undefined;
    const errorMessage = typeof data["Error Message"] === "string" ? data["Error Message"] : undefined;
    const information = typeof data.Information === "string" ? data.Information : undefined;
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
function parseSeriesEntry(timestamp, values) {
    const seconds = Math.floor(new Date(timestamp).getTime() / 1000);
    if (!Number.isFinite(seconds)) {
        return null;
    }
    const open = toNumber(values["1. open"]);
    const high = toNumber(values["2. high"]);
    const low = toNumber(values["3. low"]);
    const close = toNumber(values["4. close"]);
    const volume = toNumber(values["5. volume"]) ?? toNumber(values["6. volume"]) ?? 0;
    if (open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined) {
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
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async request(params) {
        const url = new URL(ALPHA_VANTAGE_BASE_URL);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
        url.searchParams.set("apikey", this.apiKey);
        const data = await fetchJson(url.toString(), {
            provider: "alphavantage",
        });
        if (data.Note || data["Error Message"] || data.Information) {
            throw parseAlphaError(data);
        }
        return data;
    }
    async getQuote(symbol) {
        const data = await this.request({
            function: "GLOBAL_QUOTE",
            symbol,
        });
        const quote = data["Global Quote"];
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
    async getCompanyProfile(symbol) {
        const data = await this.request({
            function: "OVERVIEW",
            symbol,
        });
        if (!data.Symbol) {
            return null;
        }
        return {
            symbol,
            name: data.Name,
            exchange: data.Exchange,
            currency: data.Currency,
            country: data.Country,
            industry: data.Industry,
            ipo: data.LatestQuarter,
            marketCapitalization: toNumber(data.MarketCapitalization),
            website: data.OfficialSite,
            source: "alphavantage",
        };
    }
    async getCandles(symbol, interval, from, to) {
        const alphaInterval = ALPHA_INTERVAL[interval];
        let fn = "";
        let seriesKey = "";
        const params = {
            symbol,
            outputsize: "full",
        };
        if (["1", "5", "15", "30", "60"].includes(interval)) {
            fn = "TIME_SERIES_INTRADAY";
            params.interval = alphaInterval;
            seriesKey = `Time Series (${alphaInterval})`;
        }
        else if (interval === "D") {
            fn = "TIME_SERIES_DAILY";
            seriesKey = "Time Series (Daily)";
        }
        else if (interval === "W") {
            fn = "TIME_SERIES_WEEKLY";
            seriesKey = "Weekly Time Series";
        }
        else {
            fn = "TIME_SERIES_MONTHLY";
            seriesKey = "Monthly Time Series";
        }
        params.function = fn;
        const data = await this.request(params);
        const series = data[seriesKey];
        if (!series) {
            return null;
        }
        return Object.entries(series)
            .map(([timestamp, values]) => parseSeriesEntry(timestamp, values))
            .filter((item) => item !== null)
            .filter((item) => item.timestamp >= from && item.timestamp <= to)
            .sort((a, b) => a.timestamp - b.timestamp);
    }
    async getNews(symbol, limit) {
        const data = await this.request({
            function: "NEWS_SENTIMENT",
            tickers: symbol,
            limit,
            sort: "LATEST",
        });
        const feed = data.feed;
        if (!feed?.length) {
            return null;
        }
        return feed.map((item) => ({
            headline: item.title ?? "Untitled",
            summary: item.summary,
            url: item.url,
            source: item.source,
            datetime: typeof item.time_published === "string"
                ? Math.floor(new Date(item.time_published).getTime() / 1000)
                : undefined,
        }));
    }
    async getRsi(symbol, interval, period) {
        const data = await this.request({
            function: "RSI",
            symbol,
            interval: ALPHA_INTERVAL[interval],
            time_period: period,
            series_type: "close",
        });
        const rsiData = data["Technical Analysis: RSI"];
        if (!rsiData) {
            return null;
        }
        return Object.entries(rsiData)
            .map(([timestamp, values]) => ({
            timestamp: Math.floor(new Date(timestamp).getTime() / 1000),
            value: toNumber(values.RSI),
        }))
            .filter((point) => typeof point.value === "number")
            .sort((a, b) => a.timestamp - b.timestamp);
    }
    async getMacd(symbol, interval) {
        const data = await this.request({
            function: "MACD",
            symbol,
            interval: ALPHA_INTERVAL[interval],
            series_type: "close",
        });
        const macdData = data["Technical Analysis: MACD"];
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
            .filter((point) => typeof point.macd === "number" && typeof point.signal === "number")
            .sort((a, b) => a.timestamp - b.timestamp);
    }
    async getKeyFinancials(symbol) {
        const data = await this.request({
            function: "OVERVIEW",
            symbol,
        });
        if (!data.Symbol) {
            return null;
        }
        return {
            symbol,
            peRatio: toNumber(data.PERatio),
            eps: toNumber(data.EPS),
            bookValue: toNumber(data.BookValue),
            dividendYield: toNumber(data.DividendYield),
            week52High: toNumber(data["52WeekHigh"]),
            week52Low: toNumber(data["52WeekLow"]),
            marketCapitalization: toNumber(data.MarketCapitalization),
            beta: toNumber(data.Beta),
            source: "alphavantage",
        };
    }
}
