function ema(values, period) {
    if (values.length < period) {
        return [];
    }
    const multiplier = 2 / (period + 1);
    const output = new Array(values.length).fill(null);
    let previous = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
    output[period - 1] = previous;
    for (let i = period; i < values.length; i += 1) {
        previous = (values[i] - previous) * multiplier + previous;
        output[i] = previous;
    }
    return output;
}
export function calculateRsiFromCandles(candles, period = 14) {
    if (candles.length <= period) {
        return [];
    }
    const closes = candles.map((candle) => candle.close);
    const gains = [];
    const losses = [];
    for (let i = 1; i < closes.length; i += 1) {
        const delta = closes[i] - closes[i - 1];
        gains.push(Math.max(delta, 0));
        losses.push(Math.max(-delta, 0));
    }
    let avgGain = gains.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    const points = [];
    for (let i = period; i < gains.length; i += 1) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
        points.push({
            timestamp: candles[i + 1].timestamp,
            value: rsi,
        });
    }
    return points;
}
export function calculateMacdFromCandles(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (candles.length < slowPeriod + signalPeriod) {
        return [];
    }
    const closes = candles.map((candle) => candle.close);
    const fast = ema(closes, fastPeriod);
    const slow = ema(closes, slowPeriod);
    const macdLine = closes.map((_, index) => {
        if (fast[index] === null || slow[index] === null) {
            return null;
        }
        return fast[index] - slow[index];
    });
    const cleanMacd = macdLine.filter((value) => value !== null);
    const signalRaw = ema(cleanMacd, signalPeriod);
    if (!signalRaw.length) {
        return [];
    }
    const output = [];
    let signalCursor = 0;
    for (let i = 0; i < macdLine.length; i += 1) {
        const macd = macdLine[i];
        if (macd === null) {
            continue;
        }
        const signal = signalRaw[signalCursor];
        signalCursor += 1;
        if (signal === null || signal === undefined) {
            continue;
        }
        output.push({
            timestamp: candles[i].timestamp,
            macd,
            signal,
            histogram: macd - signal,
        });
    }
    return output;
}
