export const FINANCIAL_DISCLAIMER =
  "Informational use only. This is not financial advice.";

function fmtNumber(value: number | undefined, decimals = 2): string {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(decimals);
}

function fmtPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
}

function fmtDateFromUnix(timestamp: number | undefined): string {
  if (!timestamp) {
    return "n/a";
  }
  return new Date(timestamp * 1000).toISOString();
}

export function formatResponse(options: {
  title: string;
  lines: string[];
  source?: string;
  warning?: string;
  includeDisclaimer?: boolean;
}): string {
  const chunks: string[] = [options.title];
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

export function lineMoney(label: string, value: number | undefined): string {
  return `${label}: $${fmtNumber(value)}`;
}

export function lineNumber(label: string, value: number | undefined, decimals = 2): string {
  return `${label}: ${fmtNumber(value, decimals)}`;
}

export function linePercent(label: string, value: number | undefined): string {
  return `${label}: ${fmtPercent(value)}`;
}

export function lineDate(label: string, timestamp: number | undefined): string {
  return `${label}: ${fmtDateFromUnix(timestamp)}`;
}

