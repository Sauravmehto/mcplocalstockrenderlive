export const FINANCIAL_DISCLAIMER = "Informational use only. This is not financial advice.";
function fmtNumber(value, decimals = 2) {
    if (value === undefined || Number.isNaN(value)) {
        return "n/a";
    }
    return value.toFixed(decimals);
}
function fmtPercent(value) {
    if (value === undefined || Number.isNaN(value)) {
        return "n/a";
    }
    return `${value.toFixed(2)}%`;
}
function fmtDateFromUnix(timestamp) {
    if (!timestamp) {
        return "n/a";
    }
    return new Date(timestamp * 1000).toISOString();
}
export function formatResponse(options) {
    const chunks = [options.title];
    if (options.source) {
        chunks.push(`Source: ${options.source}`);
    }
    if (options.warning) {
        chunks.push(`Warning: ${options.warning}`);
    }
    chunks.push(...options.lines);
    if (options.includeDisclaimer ?? true) {
        chunks.push("---", FINANCIAL_DISCLAIMER);
    }
    return chunks.join("\n");
}
export function lineMoney(label, value) {
    return `${label}: $${fmtNumber(value)}`;
}
export function lineNumber(label, value, decimals = 2) {
    return `${label}: ${fmtNumber(value, decimals)}`;
}
export function linePercent(label, value) {
    return `${label}: ${fmtPercent(value)}`;
}
export function lineDate(label, timestamp) {
    return `${label}: ${fmtDateFromUnix(timestamp)}`;
}
