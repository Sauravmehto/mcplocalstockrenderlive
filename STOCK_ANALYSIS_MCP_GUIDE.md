# Stock Analysis AI with MCP and LLM Agents

This document organizes your notes into a practical guide for building a stock analysis AI using the Model Context Protocol (MCP), LLMs, and agent orchestration.

## 1) High-Level Architecture

### LLM (The Brain)
- Examples: Claude 3.5/3+, GPT-4.5, Gemini Advanced.
- Role: Understand user intent, reason over numbers/documents, and generate analysis.

### MCP Server (The Hands)
- Role: Expose standardized tools the LLM can call for live market data and analysis.
- Typical tools:
  - Real-time prices
  - Historical OHLCV data
  - Technical indicators (RSI, MACD, etc.)
  - Fundamental reports (income statement, balance sheet, cash flow)
  - SEC filings / research data

### LLM Agent (The Controller)
- Role: Decide which tools to call and in what order.
- Popular orchestration options: LangGraph, CrewAI.

## 2) MCP Servers for Stock Data

Common options:
- Alpha Vantage MCP: live prices, history, and many technical indicators.
- Financial Datasets MCP: fundamentals and financial statements.
- Indian Stock Exchange MCP: NSE/BSE-focused data.
- Octagon AI MCP: market data + research workflows, including filings.

## 3) Build Flow for a Stock Analysis Agent

1. **Select an MCP host client**
   - Claude Desktop, Cursor, or VS Code with MCP support.
2. **Configure one or more MCP servers**
   - Add command-based or remote server config.
3. **Design agent behavior**
   - Example: separate technical and fundamental sub-agents.
4. **Add guardrails**
   - Validate outputs, handle missing data, and enforce API rate limits.

## 4) Fastest Way: Build with FastMCP (Python)

FastMCP removes most MCP protocol boilerplate and is a great starting point.

### 4.1 Environment Setup

Install `uv`, then initialize project:

```bash
uv init stock-mcp-server
cd stock-mcp-server
uv add fastmcp yfinance
```

### 4.2 Example Server Code

Create `server.py`:

```python
import yfinance as yf
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("StockPro")

@mcp.tool()
def get_stock_price(ticker: str) -> str:
    """Fetch the latest price for a stock ticker."""
    stock = yf.Ticker(ticker)
    price = stock.fast_info["last_price"]
    return f"The current price of {ticker} is ${price:.2f}"

if __name__ == "__main__":
    mcp.run()
```

Important:
- Keep tool docstrings descriptive; LLMs use them to choose tools.

### 4.3 Test with MCP Inspector

```bash
uv run mcp dev server.py
```

Then open the Inspector URL (commonly `http://localhost:6274`) and test `get_stock_price`.

## 5) Client Configuration Examples

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "stock-pro": {
      "command": "uv",
      "args": ["run", "absolute/path/to/server.py"]
    }
  }
}
```

### Cursor (Command-based MCP server)
- Command: `uv`
- Args: `run`, `absolute/path/to/server.py`

If your server needs secrets:

```json
{
  "mcpServers": {
    "stock-analysis": {
      "command": "python",
      "args": ["path/to/server.py"],
      "env": {
        "API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

## 6) Guardrails and Production Considerations

- Validate tool inputs and outputs (ticker format, date ranges, units).
- Add error handling for API/network failures.
- Respect provider rate limits (for example, Alpha Vantage free-tier limits).
- Add retries with backoff and request caching where useful.
- Keep a clear disclaimer: outputs are informational, not financial advice.

## 7) Advanced Extensions

- Technical indicator suite (RSI, MACD, Bollinger Bands).
- Fundamental scoring tools (quality, growth, valuation).
- Sentiment tools for earnings calls/news transcripts.
- Multi-modal chart analysis with vision-capable models.
- Portfolio-level risk and scenario analysis tools.

## 8) Optional No-Code/Low-Code Path

- You can use an MCP API generator (for example, from existing Postman collections) to expose financial APIs quickly with less custom code.

## 9) Suggested Next Step

Start with one robust tool (`get_stock_price`) and one analysis tool (`get_rsi`), verify in MCP Inspector, then connect to Claude Desktop and scale gradually.

