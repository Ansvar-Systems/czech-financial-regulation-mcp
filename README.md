# Czech Financial Regulation MCP

MCP server for querying CNB (Česká národní banka / Czech National Bank) financial regulations. Provides access to CNB vyhlášky (decrees), úřední sdělení (official communications), dohledové benchmarky (supervisory benchmarks), and enforcement actions.

## Tools

| Tool | Description |
|------|-------------|
| `cz_fin_search_regulations` | Full-text search across CNB provisions. Supports Czech-language queries. |
| `cz_fin_get_regulation` | Retrieve a specific provision by sourcebook and reference. |
| `cz_fin_list_sourcebooks` | List all CNB regulatory sourcebooks. |
| `cz_fin_search_enforcement` | Search CNB enforcement actions and sanctions. |
| `cz_fin_check_currency` | Check whether a provision reference is currently in force. |
| `cz_fin_about` | Return server metadata and tool list. |

## Sourcebooks

| ID | Name |
|----|------|
| `CNB_VYHLASKY` | CNB Vyhlášky (Decrees) — binding prudential requirements |
| `CNB_UREDNI_SDELENI` | CNB Úřední sdělení (Official Communications) — supervisory guidance |
| `CNB_DOHLEDOVE_BENCHMARKY` | CNB Dohledové benchmarky (Supervisory Benchmarks) — quantitative standards |

## Data Source

CNB regulatory publications: [https://www.cnb.cz/](https://www.cnb.cz/)

## Setup

```bash
npm install
npm run build
npm run seed         # populate sample data
npm start            # HTTP server on port 3000
```

Set `CNB_DB_PATH` to use a custom database location (default: `data/cnb.db`).

## Docker

```bash
docker build -t czech-financial-regulation-mcp .
docker run --rm -p 3000:3000 -v /path/to/data:/app/data czech-financial-regulation-mcp
```

## License

Apache-2.0 — Ansvar Systems AB
