# Czech Financial Regulation MCP — Data Coverage

## Corpus Summary

| Metric | Value |
|--------|-------|
| Total provisions | 498 |
| Enforcement actions | 26 |
| Last ingested | 2026-03-23 |
| Data language | Czech (cs) |
| Jurisdiction | Czech Republic (CZ) |

## Sourcebooks

### CNB_VYHLASKY — Vyhlášky ČNB
Czech National Bank decrees — binding secondary legislation issued by CNB under delegated authority from primary Czech financial laws (e.g. Zákon o bankách, Zákon o podnikání na kapitálovém trhu).

- **Source:** https://www.cnb.cz/cs/legislativa/vyhlasky/
- **Status:** Ingested; covers active decrees across banking, capital markets, insurance, payment services, AML, and crypto-assets sectors.

### CNB_UREDNI_SDELENI — Úřední sdělení ČNB
CNB official communications — interpretive notices clarifying regulatory requirements. Non-binding but regularly cited in supervisory assessments.

- **Source:** https://www.cnb.cz/cs/legislativa/uredni_sdeleni/
- **Status:** Ingested; covers official communications across all regulated sectors.

### CNB_DOHLEDOVE_BENCHMARKY — Dohledové benchmarky ČNB
CNB supervisory benchmarks and dohledová sdělení — supervisory expectations for regulated entities. Covers 2012–2026.

- **Source:** https://www.cnb.cz/cs/dohled-financni-trh/vykon-dohledu/dohledova-uredni-sdeleni-a-benchmarky/
- **Status:** Ingested; 54 benchmark and supervisory communication documents.

### CNB_ENFORCEMENT — Pravomocná rozhodnutí ČNB
CNB enforcement decisions — sanctions, fines, licence revocations, and restrictions issued against regulated entities.

- **Source:** https://www.cnb.cz/cs/dohled-financni-trh/vykon-dohledu/pravomocna-rozhodnuti/
- **Status:** 26 enforcement actions ingested from three CNB enforcement pages.

## Regulatory Categories Ingested

The following CNB regulatory categories are covered:

| Category | Description |
|----------|-------------|
| CNB_BANKY | Banking sector regulations |
| CNB_POJISTOVNY | Insurance companies |
| CNB_PENZIJNI | Pension funds |
| CNB_OBCHODNICI_CP | Securities dealers |
| CNB_INVESTICNI | Investment firms |
| CNB_PLATEBNI | Payment institutions |
| CNB_SMENARNY | Currency exchange offices |
| CNB_AML | Anti-money laundering |
| CNB_EMISE | Securities issuance |
| CNB_OBCHODNI_SYSTEMY | Trading systems |
| CNB_OTC_DERIVATY | OTC derivatives |
| CNB_SPOTREBITEL | Consumer protection |
| CNB_KRYPTOAKTIVA | Crypto-assets (MiCA implementation) |
| CNB_DORA | Digital Operational Resilience Act |
| CNB_UDRZITELNE_FINANCE | Sustainable finance |
| CNB_OZDRAVNE_POSTUPY | Recovery and resolution |
| CNB_KONGLOMERATY | Financial conglomerates |

## Known Gaps

- **CNB press releases** are not included (not regulatory instruments)
- **Informal CNB guidance** published outside official channels is not included
- **Historical repealed decrees** prior to the CNB website archive may be incomplete
- **Full decree text** for some older vyhlášky may be summarised rather than full text
- **EU directly applicable regulations** (e.g. CRR, EMIR) are not included — use the EU Regulations MCP for those

## Freshness

Data is ingested periodically via `npm run ingest`. Use the `cz_fin_check_data_freshness` tool to check the last ingest date. The hosted version at `mcp.ansvar.eu` is rebuilt monthly via GitHub Actions.
