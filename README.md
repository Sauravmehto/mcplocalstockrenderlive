# Local Stock Analyst MCP (stdio)

Local TypeScript MCP server for Claude Desktop that exposes stock-analysis tools using:

- Finnhub as the primary provider
- Alpha Vantage as fallback
- local indicator calculation fallback for RSI and MACD

The server supports:

- `stdio` mode for local Claude Desktop integration (default)
- `HTTP` mode for cloud hosting (for example, Render)

## Tools

- `get_stock_price`
- `get_quote`
- `get_company_profile`
- `get_candles`
- `get_stock_news`
- `get_rsi`
- `get_macd`
- `get_key_financials`

Each tool validates input with `zod`, formats output consistently, and includes an informational disclaimer.

## Requirements

- Node.js 18+
- npm
- API key for at least one provider:
  - Finnhub: `FINNHUB_API_KEY`
  - Alpha Vantage: `ALPHAVANTAGE_API_KEY`

## Setup

1) Install dependencies:

```bash
npm install
```

2) Create env file from template:

```bash
copy .env.example .env
```

3) Add your API keys to `.env`.

## Build and Run

Build:

```bash
npm run build
```

Start locally (stdio MCP mode):

```bash
npm start
```

Start in HTTP mode (Render-style):

```bash
set MCP_TRANSPORT=http
set PORT=3000
npm start
```

HTTP endpoints:

- MCP endpoint: `/mcp`
- health check: `/healthz`

## Claude Desktop (Windows) Configuration

Open your Claude Desktop config file:

- `%APPDATA%\Claude\claude_desktop_config.json`

Add/update:

```json
{
  "mcpServers": {
    "local-stock-analyst": {
      "command": "node",
      "args": ["D:/mcpserverdemo/mcplocalstock/build/index.js"],
      "env": {
        "FINNHUB_API_KEY": "YOUR_FINNHUB_KEY",
        "ALPHAVANTAGE_API_KEY": "YOUR_ALPHA_VANTAGE_KEY"
      }
    }
  }
}
```

Notes:

- Use absolute paths in `args`.
- Forward slashes are safe on Windows JSON paths.
- Restart Claude Desktop after saving config.

## Deploy on Render

Use a **Web Service** deployment.

1) Push this project to GitHub.
2) In Render, create a new Web Service from your repo.
3) Configure:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
4) Add environment variables:
   - `MCP_TRANSPORT=http`
   - `FINNHUB_API_KEY=...` (optional but recommended)
   - `ALPHAVANTAGE_API_KEY=...` (optional fallback)
   - `PORT` is auto-provided by Render.
5) Deploy.

After deploy, verify:

- `https://<your-service>.onrender.com/healthz` returns `{"status":"ok"}`
- MCP server endpoint is `https://<your-service>.onrender.com/mcp`

## Quick Test Prompts in Claude

- "Call `get_stock_price` for `MSFT`."
- "Call `get_candles` for `MSFT`, interval `D`, from `1704067200`, to `1735689600`, limit `5`."
- "Call `get_rsi` for `MSFT`, interval `D`, from `1704067200`, to `1735689600`."

## Troubleshooting

- **No tools visible in Claude**
  - Check JSON validity of `claude_desktop_config.json`.
  - Confirm `build/index.js` exists (`npm run build`).
  - Fully restart Claude Desktop.
- **Auth errors**
  - Verify API keys in config `env` or local `.env`.
- **Rate-limit errors**
  - Retry later, reduce call frequency, or use higher-tier keys.
  - The server automatically attempts Alpha Vantage fallback after Finnhub failures.

## Logs

- Claude Desktop logs are usually in `%APPDATA%\Claude\logs`.
- Server startup/errors are written to stderr by the MCP process.

