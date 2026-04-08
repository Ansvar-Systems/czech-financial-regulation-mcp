# Czech Financial Regulation MCP — Tool Reference

All tools are prefixed with `cz_fin_`. Every response includes a `_meta` block with disclaimer, source URL, copyright, and data age.

---

## cz_fin_search_regulations

Full-text search across CNB regulatory provisions (vyhlášky, úřední sdělení, dohledové benchmarky).

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query in Czech or English (e.g., `'kapitálové požadavky'`, `'AML'`, `'řízení rizik'`) |
| `sourcebook` | string | No | Filter by sourcebook ID: `CNB_VYHLASKY`, `CNB_UREDNI_SDELENI`, `CNB_DOHLEDOVE_BENCHMARKY` |
| `status` | string | No | Filter by status: `in_force`, `deleted`, `not_yet_in_force` |
| `limit` | number | No | Max results (default 20, max 100) |

**Output:** `{ results: Provision[], count: number, _meta }`

---

## cz_fin_get_regulation

Get a specific CNB provision by sourcebook and reference.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourcebook` | string | Yes | Sourcebook ID (e.g., `CNB_VYHLASKY`) |
| `reference` | string | Yes | Provision reference (e.g., `'Vyhláška č. 163/2014 Sb.'`, `'ÚS 2023/1'`) |

**Output:** `Provision | error`

```
Provision {
  id: number
  sourcebook_id: string
  reference: string
  title: string | null
  text: string
  type: string | null
  status: string          // "in_force" | "deleted" | "not_yet_in_force"
  effective_date: string | null
  chapter: string | null
  section: string | null
  _meta: Meta
}
```

---

## cz_fin_list_sourcebooks

List all CNB regulatory sourcebooks with names and descriptions.

**Input:** none

**Output:** `{ sourcebooks: Sourcebook[], count: number, _meta }`

---

## cz_fin_search_enforcement

Search CNB enforcement actions — sanctions, fines, licence revocations.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (entity name, breach type, e.g., `'AML'`, `'praní peněz'`) |
| `action_type` | string | No | Filter: `fine`, `ban`, `restriction`, `warning` |
| `limit` | number | No | Max results (default 20, max 100) |

**Output:** `{ results: EnforcementAction[], count: number, _meta }`

```
EnforcementAction {
  id: number
  firm_name: string
  reference_number: string | null
  action_type: string | null
  amount: number | null
  date: string | null
  summary: string | null
  sourcebook_references: string | null
}
```

---

## cz_fin_check_currency

Check whether a CNB provision reference is currently in force.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | Provision reference to check |

**Output:** `{ reference, status, effective_date, found, _meta }`

---

## cz_fin_about

Return server metadata: version, description, data source, and tool list.

**Input:** none

**Output:** `{ name, version, description, data_source, tools[], _meta }`

---

## cz_fin_list_sources

List all CNB data sources with full provenance metadata.

**Input:** none

**Output:** `{ sources: Source[], _meta }`

```
Source {
  id: string           // e.g. "CNB_VYHLASKY"
  name: string
  description: string
  authority: string
  source_url: string
  jurisdiction: string // "CZ"
  language: string     // "cs"
  license: string
}
```

---

## cz_fin_check_data_freshness

Check data freshness: last ingest date, staleness, record counts, and update instructions.

**Input:** none

**Output:**

```
{
  status: "fresh" | "stale" | "unknown"
  last_ingest: string | null       // ISO 8601
  stale_days: number | null
  stale_threshold_days: number     // 30
  provision_count: number | null
  enforcement_count: number | null
  update_instructions: string
  _meta: Meta
}
```

---

## _meta block

Every successful tool response includes:

```json
{
  "_meta": {
    "disclaimer": "This data is sourced from official CNB publications...",
    "source_url": "https://www.cnb.cz/",
    "copyright": "© Česká národní banka (Czech National Bank)...",
    "data_age": "2026-03-23T15:34:32.104Z"
  }
}
```
