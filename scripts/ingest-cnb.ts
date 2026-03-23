#!/usr/bin/env tsx
/**
 * Ingestion crawler for the Czech National Bank (CNB) financial regulation MCP.
 *
 * Three-phase pipeline:
 *   Phase 1 — Discover regulations from CNB legislativní základna category pages
 *   Phase 2 — Crawl dohledové benchmarky & dohledová sdělení (supervisory docs)
 *   Phase 3 — Crawl pravomocná rozhodnutí (enforcement actions)
 *
 * Sources:
 *   - https://www.cnb.cz/cs/dohled-financni-trh/legislativni-zakladna/
 *   - https://www.cnb.cz/cs/dohled-financni-trh/vykon-dohledu/dohledova-uredni-sdeleni-a-benchmarky/
 *   - https://www.cnb.cz/cs/legislativa/vykon-cinnosti-a-obezretnostni-pravidla/
 *   - https://www.cnb.cz/cs/dohled-financni-trh/vykon-dohledu/pravomocna-rozhodnuti/
 *
 * Usage:
 *   npx tsx scripts/ingest-cnb.ts
 *   npx tsx scripts/ingest-cnb.ts --dry-run
 *   npx tsx scripts/ingest-cnb.ts --resume
 *   npx tsx scripts/ingest-cnb.ts --force
 *   npx tsx scripts/ingest-cnb.ts --phase provisions
 *   npx tsx scripts/ingest-cnb.ts --phase benchmarks
 *   npx tsx scripts/ingest-cnb.ts --phase enforcement
 *   npx tsx scripts/ingest-cnb.ts --limit 10
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_SQL } from "../src/db.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env["CNB_DB_PATH"] ?? "data/cnb.db";
const STATE_PATH = join(dirname(DB_PATH), "ingest-state.json");
const BASE_URL = "https://www.cnb.cz";
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;

const USER_AGENT =
  "AnsvarCNBCrawler/1.0 (+https://ansvar.eu; compliance research)";

/**
 * Legislative foundation category pages. Each maps a sourcebook ID to the
 * CNB page listing that sector's legal regulations.
 */
const LEGISLATION_CATEGORIES: { id: string; name: string; path: string }[] = [
  {
    id: "CNB_BANKY",
    name: "Banky a družstevní záložny",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/banky-a-druzstevni-zalozny/pravni-predpisy/",
  },
  {
    id: "CNB_POJISTOVNY",
    name: "Pojišťovny, zajišťovny a pojišťovací zprostředkovatelé",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/pojistovny-zajistovny-a-pojistovaci-zprostredkovatele/pravni-predpisy/",
  },
  {
    id: "CNB_PENZIJNI",
    name: "Penzijní společnosti a fondy",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/penzijni-spolecnosti-a-fondy-zprostredkovatele-penzijnich-produktu-/pravni-predpisy/",
  },
  {
    id: "CNB_OBCHODNICI_CP",
    name: "Obchodníci s cennými papíry, investiční zprostředkovatelé",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/obchodnici-s-cennymi-papiry-investicni-zprostredkovatele/pravni-predpisy/",
  },
  {
    id: "CNB_INVESTICNI",
    name: "Investiční společnosti a investiční fondy",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/investicni-spolecnosti-a-investicni-fondy/pravni-predpisy/",
  },
  {
    id: "CNB_PLATEBNI",
    name: "Platební instituce a instituce elektronických peněz",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/platebni-instituce-a-instituce-elektronickych-penez/pravni-predpisy/",
  },
  {
    id: "CNB_SMENARNY",
    name: "Směnárny",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/smenarny/pravni-predpisy/",
  },
  {
    id: "CNB_AML",
    name: "Legalizace výnosů z trestné činnosti (AML/CFT)",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/legalizace-vynosu-z-trestne-cinnosti/pravni-predpisy/",
  },
  {
    id: "CNB_EMISE",
    name: "Emise, nabídky převzetí a vytěsnění",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/emise-a-evidence-cennych-papiru-nabidky-prevzeti-a-vytesneni/pravni-predpisy/",
  },
  {
    id: "CNB_OBCHODNI_SYSTEMY",
    name: "Obchodní systémy, vypořádání a ochrana trhu",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/obchodni-systemy-vyporadani-a-ochrana-trhu/pravni-predpisy/",
  },
  {
    id: "CNB_OTC_DERIVATY",
    name: "Obchodování s OTC deriváty, sekuritizace a crowdfunding",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/obchodovani-s-otc-derivaty-a-sekuritizace/pravni-predpisy/",
  },
  {
    id: "CNB_SPOTREBITEL",
    name: "Ochrana spotřebitele a spotřebitelský úvěr",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/ochrana-spotrebitele-a-spotrebitelsky-uver/pravni-predpisy/",
  },
  {
    id: "CNB_KRYPTOAKTIVA",
    name: "Kryptoaktiva (MiCA)",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/kryptoaktiva/pravni-predpisy/",
  },
  {
    id: "CNB_DORA",
    name: "Digitální provozní odolnost (DORA)",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/digitalni-provozni-odolnost/pravni-predpisy/",
  },
  {
    id: "CNB_UDRZITELNE_FINANCE",
    name: "Udržitelné finance",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/udrzitelne-finance/pravni-predpisy/",
  },
  {
    id: "CNB_OZDRAVNE_POSTUPY",
    name: "Ozdravné postupy a řešení krize",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/ozdravne-postupy-a-reseni-krize/pravni-predpisy/",
  },
  {
    id: "CNB_KONGLOMERATY",
    name: "Finanční konglomeráty",
    path: "/cs/dohled-financni-trh/legislativni-zakladna/financni-konglomeraty/pravni-predpisy/",
  },
];

/**
 * Additional page listing CNB official communications (úřední sdělení)
 * on prudential rules and conduct of activity.
 */
const OFFICIAL_COMMUNICATIONS_PATH =
  "/cs/legislativa/vykon-cinnosti-a-obezretnostni-pravidla/";

/**
 * Dohledové benchmarky & sdělení landing page.
 */
const BENCHMARKS_PATH =
  "/cs/dohled-financni-trh/vykon-dohledu/dohledova-uredni-sdeleni-a-benchmarky/";

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliFlags {
  dryRun: boolean;
  resume: boolean;
  force: boolean;
  phase: "all" | "provisions" | "benchmarks" | "enforcement";
  limit: number;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    dryRun: false,
    resume: false,
    force: false,
    phase: "all",
    limit: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--resume":
        flags.resume = true;
        break;
      case "--force":
        flags.force = true;
        break;
      case "--phase":
        flags.phase = (args[++i] ?? "all") as CliFlags["phase"];
        break;
      case "--limit":
        flags.limit = parseInt(args[++i] ?? "0", 10);
        break;
      default:
        console.error(`Unknown flag: ${arg}`);
        process.exit(1);
    }
  }

  return flags;
}

// ─── Resume state ────────────────────────────────────────────────────────────

interface IngestState {
  completedCategories: string[];
  completedBenchmarkUrls: string[];
  completedEnforcementUrls: string[];
  provisionCount: number;
  enforcementCount: number;
  lastRun: string;
}

function loadState(): IngestState {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, "utf-8")) as IngestState;
    } catch {
      // Corrupted state — start fresh
    }
  }
  return {
    completedCategories: [],
    completedBenchmarkUrls: [],
    completedEnforcementUrls: [],
    provisionCount: 0,
    enforcementCount: 0,
    lastRun: "",
  };
}

function saveState(state: IngestState): void {
  state.lastRun = new Date().toISOString();
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

let lastFetchTime = 0;

async function rateLimit(): Promise<void> {
  const elapsed = Date.now() - lastFetchTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastFetchTime = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await rateLimit();
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,*/*",
          "Accept-Language": "cs,en;q=0.5",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429 || status >= 500) {
          const backoff = RETRY_BACKOFF_MS * attempt;
          console.warn(
            `  [retry ${attempt}/${MAX_RETRIES}] HTTP ${status} for ${url}, waiting ${backoff}ms`,
          );
          await sleep(backoff);
          continue;
        }
        throw new Error(`HTTP ${status} for ${url}`);
      }

      return await response.text();
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Failed after ${MAX_RETRIES} attempts: ${url} — ${(err as Error).message}`,
        );
      }
      const backoff = RETRY_BACKOFF_MS * attempt;
      console.warn(
        `  [retry ${attempt}/${MAX_RETRIES}] ${(err as Error).message}, waiting ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
  throw new Error(`Unreachable: exhausted retries for ${url}`);
}

function resolveUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

interface RawProvision {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string | null;
  chapter: string | null;
  section: string | null;
  source_url: string;
}

interface RawEnforcement {
  firm_name: string;
  reference_number: string | null;
  action_type: string;
  amount: number;
  date: string | null;
  summary: string;
  sourcebook_references: string | null;
}

/**
 * Parse a legislative foundation category page.
 *
 * CNB category pages list regulations as bullet-point links under section
 * headings. We extract each link as a provision reference, then follow the
 * link to get the full text if it points to a CNB-hosted page or PDF
 * description page.
 */
function parseCategoryPage(
  html: string,
  sourcebookId: string,
): RawProvision[] {
  const $ = cheerio.load(html);
  const provisions: RawProvision[] = [];

  // CNB uses .page-cnt or .content as the main content area
  const contentArea =
    $(".page-cnt").length > 0
      ? $(".page-cnt")
      : $(".content").length > 0
        ? $(".content")
        : $("main").length > 0
          ? $("main")
          : $("body");

  // Track section context from headings
  let currentChapter: string | null = null;
  let currentType = "předpis";

  contentArea.find("h2, h3, h4, li, p").each((_i, el) => {
    const tag = (el as unknown as DomElement).tagName?.toLowerCase();

    // Update context from headings
    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const headingText = $(el).text().trim();
      currentChapter = headingText;

      // Determine provision type from heading text
      if (/vyhl[aá][sš]k/i.test(headingText)) {
        currentType = "vyhláška";
      } else if (/z[aá]kon/i.test(headingText)) {
        currentType = "zákon";
      } else if (/na[rř][ií]zen[ií]/i.test(headingText)) {
        currentType = "nařízení EU";
      } else if (/opat[rř]en[ií]/i.test(headingText)) {
        currentType = "opatření obecné povahy";
      } else if (/[uú][rř]edn[ií]\s+sd[eě]len[ií]/i.test(headingText)) {
        currentType = "úřední sdělení";
      }
      return;
    }

    // Extract regulation references from links in list items and paragraphs
    const links = $(el).find("a[href]");
    if (links.length === 0) return;

    links.each((_j, link) => {
      const href = $(link).attr("href");
      if (!href) return;

      const linkText = $(link).text().trim();
      if (!linkText || linkText.length < 5) return;

      // Skip navigation, footer, and non-regulation links
      if (
        href.includes("#") && !href.includes(".pdf") ||
        href.includes("mailto:") ||
        href.includes("javascript:")
      ) {
        return;
      }

      // Extract the full text: the link text plus any trailing text in the
      // parent element that describes the regulation
      const parentText = $(el).text().trim();
      const description = parentText.length > linkText.length ? parentText : linkText;

      // Try to extract a Sbírka zákonů reference (e.g., "č. 163/2014 Sb.")
      const sbirkaMatch = description.match(
        /(?:č\.\s*)?(\d+\/\d{4})\s*Sb\b/i,
      );
      const reference = sbirkaMatch
        ? `${currentType === "vyhláška" ? "Vyhláška" : currentType === "zákon" ? "Zákon" : "Předpis"} č. ${sbirkaMatch[1]} Sb.`
        : linkText;

      // Try to extract effective date from text
      const dateMatch = description.match(
        /(?:ze dne|účinn(?:ost|ý)\s+(?:od|ode dne))\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i,
      );
      let effectiveDate: string | null = null;
      if (dateMatch) {
        const [, d, m, y] = dateMatch;
        effectiveDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
      } else {
        // Try extracting year from Sbírka reference
        const yearMatch = reference.match(/\/(\d{4})/);
        if (yearMatch) {
          effectiveDate = `${yearMatch[1]}-01-01`;
        }
      }

      const resolvedUrl = resolveUrl(href);

      provisions.push({
        sourcebook_id: sourcebookId,
        reference,
        title: description.slice(0, 500),
        text: description,
        type: currentType,
        status: "in_force",
        effective_date: effectiveDate,
        chapter: currentChapter,
        section: null,
        source_url: resolvedUrl,
      });
    });
  });

  return provisions;
}

/**
 * Fetch and parse the content of an individual regulation detail page.
 * Returns enriched text if the page has substantive content, or null if
 * the link is an external reference (e-sbirka.cz, eur-lex, etc.).
 */
async function fetchRegulationDetail(url: string): Promise<string | null> {
  // Skip external registries — we only crawl CNB-hosted content
  if (
    !url.includes("cnb.cz") ||
    url.includes("e-sbirka.cz") ||
    url.includes("eur-lex.europa.eu") ||
    url.includes("zakonyprolidi.cz")
  ) {
    return null;
  }

  // For PDFs, we cannot parse the body — keep the link reference only
  if (url.endsWith(".pdf")) {
    return null;
  }

  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    // Remove navigation, headers, footers
    $("nav, header, footer, .header, .footer, .breadcrumb, .sidebar, script, style").remove();

    const contentArea =
      $(".page-cnt").length > 0
        ? $(".page-cnt")
        : $(".content").length > 0
          ? $(".content")
          : $("main").length > 0
            ? $("main")
            : $("article");

    if (contentArea.length === 0) return null;

    const text = contentArea
      .text()
      .replace(/\s+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text.length > 100 ? text : null;
  } catch (err) {
    console.warn(`  Could not fetch detail page ${url}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Parse the dohledové benchmarky & sdělení index page.
 *
 * The page lists PDF links for each benchmark/communication, organized
 * by year. We extract references, titles, and PDF URLs.
 */
function parseBenchmarksPage(html: string): RawProvision[] {
  const $ = cheerio.load(html);
  const provisions: RawProvision[] = [];

  const contentArea =
    $(".page-cnt").length > 0
      ? $(".page-cnt")
      : $(".content").length > 0
        ? $(".content")
        : $("main").length > 0
          ? $("main")
          : $("body");

  let currentYear: string | null = null;

  contentArea.find("h2, h3, h4, li, p, a").each((_i, el) => {
    const tag = (el as unknown as DomElement).tagName?.toLowerCase();

    // Track year headings
    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const text = $(el).text().trim();
      const yearMatch = text.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        currentYear = yearMatch[1] ?? null;
      }
      return;
    }

    // Find links to benchmark/sdělení PDFs and HTML pages
    const anchors = tag === "a" ? $(el).toArray() : $(el).find("a[href]").toArray();

    for (const anchor of anchors) {
      const href = $(anchor).attr("href");
      if (!href) continue;

      const linkText = $(anchor).text().trim();
      // Also grab surrounding text from parent for context
      const parentText = $(anchor).parent().text().trim();
      const fullText = parentText.length > linkText.length ? parentText : linkText;

      // Match benchmark references
      const benchmarkMatch = fullText.match(
        /[Dd]ohledov[ýé]\s+benchmark\s+[čc]\.\s*(\d+\/\d{4})/,
      );
      const sdeleniMatch = fullText.match(
        /[Dd]ohledov[ée]\s+sd[eě]len[ií]\s+[čc]\.\s*(\d+\/\d{4})/,
      );
      const informaceMatch = fullText.match(
        /[Ii]nformace\s+dohledu\s+[čc]\.\s*(\d+\/\d{4})/,
      );
      const uredniMatch = fullText.match(
        /[Úú][řr]edn[ií]\s+sd[eě]len[ií]\s+ze\s+dne\s+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/,
      );

      let reference: string;
      let type: string;

      if (benchmarkMatch) {
        reference = `Dohledový benchmark č. ${benchmarkMatch[1]}`;
        type = "dohledový benchmark";
      } else if (sdeleniMatch) {
        reference = `Dohledové sdělení č. ${sdeleniMatch[1]}`;
        type = "dohledové sdělení";
      } else if (informaceMatch) {
        reference = `Informace dohledu č. ${informaceMatch[1]}`;
        type = "informace dohledu";
      } else if (uredniMatch) {
        reference = `Úřední sdělení ze dne ${uredniMatch[1]}`;
        type = "úřední sdělení";
      } else {
        // Skip links that don't match known document types
        continue;
      }

      // Extract or infer effective date
      let effectiveDate: string | null = null;
      const dateMatch = fullText.match(
        /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/,
      );
      if (dateMatch) {
        const [, d, m, y] = dateMatch;
        effectiveDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
      } else if (currentYear) {
        effectiveDate = `${currentYear}-01-01`;
      }

      // Extract section number from reference
      const sectionMatch = reference.match(/(\d+)\/\d{4}/);

      // Clean up title: use the descriptive text after the reference
      const titleSeparatorIndex = fullText.indexOf("–");
      const title =
        titleSeparatorIndex > -1
          ? fullText.slice(titleSeparatorIndex + 1).trim()
          : fullText;

      provisions.push({
        sourcebook_id:
          type === "dohledový benchmark"
            ? "CNB_DOHLEDOVE_BENCHMARKY"
            : "CNB_UREDNI_SDELENI",
        reference,
        title: title.slice(0, 500),
        text: fullText,
        type,
        status: "in_force",
        effective_date: effectiveDate,
        chapter: currentYear,
        section: sectionMatch ? sectionMatch[1] ?? null : null,
        source_url: resolveUrl(href),
      });
    }
  });

  return provisions;
}

/**
 * Parse the official communications page at
 * /cs/legislativa/vykon-cinnosti-a-obezretnostni-pravidla/
 *
 * This page lists vyhlášky, opatření obecné povahy, and links to úřední
 * sdělení published in the CNB Bulletin (Věstník ČNB).
 */
function parseOfficialCommunicationsPage(html: string): RawProvision[] {
  const $ = cheerio.load(html);
  const provisions: RawProvision[] = [];

  const contentArea =
    $(".page-cnt").length > 0
      ? $(".page-cnt")
      : $(".content").length > 0
        ? $(".content")
        : $("main").length > 0
          ? $("main")
          : $("body");

  let currentSection: string | null = null;
  let currentType = "úřední sdělení";

  contentArea.find("h2, h3, h4, li, p").each((_i, el) => {
    const tag = (el as unknown as DomElement).tagName?.toLowerCase();

    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const headingText = $(el).text().trim();
      currentSection = headingText;

      if (/vyhl[aá][sš]k/i.test(headingText)) {
        currentType = "vyhláška";
      } else if (/opat[rř]en[ií]/i.test(headingText)) {
        currentType = "opatření obecné povahy";
      } else if (/[uú][rř]edn[ií]/i.test(headingText)) {
        currentType = "úřední sdělení";
      }
      return;
    }

    const links = $(el).find("a[href]");
    if (links.length === 0) return;

    links.each((_j, link) => {
      const href = $(link).attr("href");
      if (!href) return;

      // Only interested in Věstník ČNB PDFs and CNB-hosted pages
      if (
        !href.includes("cnb.cz") &&
        !href.startsWith("/") &&
        !href.includes("vestnik") &&
        !href.includes("Vestnik")
      ) {
        return;
      }

      const linkText = $(link).text().trim();
      if (!linkText || linkText.length < 5) return;

      const parentText = $(el).text().trim();
      const description = parentText.length > linkText.length ? parentText : linkText;

      // Try to extract a Věstník reference or date-based reference
      const vestnikMatch = href.match(/vestnik_(\d{4})_(\d+)/);
      const sbirkaMatch = description.match(/č\.\s*(\d+\/\d{4})\s*Sb\b/i);

      let reference: string;
      if (sbirkaMatch) {
        reference =
          currentType === "vyhláška"
            ? `Vyhláška č. ${sbirkaMatch[1]} Sb.`
            : `Předpis č. ${sbirkaMatch[1]} Sb.`;
      } else if (vestnikMatch) {
        reference = `Úřední sdělení ČNB, Věstník ${vestnikMatch[1]}/${vestnikMatch[2]}`;
      } else {
        reference = linkText.slice(0, 200);
      }

      const dateMatch = description.match(
        /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/,
      );
      let effectiveDate: string | null = null;
      if (dateMatch) {
        const [, d, m, y] = dateMatch;
        effectiveDate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
      }

      provisions.push({
        sourcebook_id: "CNB_UREDNI_SDELENI",
        reference,
        title: description.slice(0, 500),
        text: description,
        type: currentType,
        status: "in_force",
        effective_date: effectiveDate,
        chapter: currentSection,
        section: null,
        source_url: resolveUrl(href),
      });
    });
  });

  return provisions;
}

/**
 * Parse an enforcement decision detail page.
 *
 * CNB enforcement decisions (pravomocná rozhodnutí) are listed in a
 * searchable database. Since the results require form submission, we
 * crawl the known sub-pages that list decisions by category.
 */
function parseEnforcementListPage(html: string): RawEnforcement[] {
  const $ = cheerio.load(html);
  const actions: RawEnforcement[] = [];

  const contentArea =
    $(".page-cnt").length > 0
      ? $(".page-cnt")
      : $(".content").length > 0
        ? $(".content")
        : $("main").length > 0
          ? $("main")
          : $("body");

  // Look for table-based results
  contentArea.find("table").each((_i, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 2) return;

    // Try to identify columns from header row
    const headers: string[] = [];
    $(rows[0])
      .find("th, td")
      .each((_j, cell) => {
        headers.push($(cell).text().trim().toLowerCase());
      });

    rows.slice(1).each((_j, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;

      const cellTexts: string[] = [];
      cells.each((_k, cell) => {
        cellTexts.push($(cell).text().trim());
      });

      // Try to map columns by header names
      const firmIdx = headers.findIndex(
        (h) =>
          h.includes("účastník") ||
          h.includes("subjekt") ||
          h.includes("název") ||
          h.includes("firma"),
      );
      const dateIdx = headers.findIndex(
        (h) => h.includes("datum") || h.includes("den"),
      );
      const typeIdx = headers.findIndex(
        (h) => h.includes("typ") || h.includes("druh") || h.includes("rozhodnutí"),
      );
      const refIdx = headers.findIndex(
        (h) => h.includes("č.j.") || h.includes("spisová") || h.includes("číslo"),
      );

      const firmName = cellTexts[firmIdx >= 0 ? firmIdx : 0] ?? "neznámý";
      const date = cellTexts[dateIdx >= 0 ? dateIdx : undefined!] ?? null;
      const actionType = cellTexts[typeIdx >= 0 ? typeIdx : undefined!] ?? "rozhodnutí";
      const refNumber = cellTexts[refIdx >= 0 ? refIdx : undefined!] ?? null;

      // Extract penalty amount if present
      let amount = 0;
      const amountMatch = cellTexts
        .join(" ")
        .match(/(\d[\d\s,.]*)\s*(?:Kč|CZK)/i);
      if (amountMatch) {
        amount = parseFloat(
          amountMatch[1]!.replace(/\s/g, "").replace(",", "."),
        );
      }

      const summary = cellTexts.join(" | ");

      actions.push({
        firm_name: firmName,
        reference_number: refNumber,
        action_type: actionType,
        amount,
        date: normalizeDate(date),
        summary,
        sourcebook_references: null,
      });
    });
  });

  // Also look for list-based decision links
  contentArea.find("li, .decision-item, .item").each((_i, el) => {
    const text = $(el).text().trim();
    if (text.length < 20) return;

    // Try to extract firm name — usually the first bold or strong element
    const firmEl = $(el).find("strong, b").first();
    const firmName = firmEl.length > 0 ? firmEl.text().trim() : text.split(/[–—,]/)[0]?.trim() ?? "neznámý";

    // Extract reference number pattern (e.g., S-Sp-2023/00123/CNB/573)
    const refMatch = text.match(/([A-Z]-[A-Z][a-z]+-\d{4}\/\d+\/CNB\/\d+)/);

    // Extract date
    const dateMatch = text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    let date: string | null = null;
    if (dateMatch) {
      const [, d, m, y] = dateMatch;
      date = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    }

    // Extract amount
    let amount = 0;
    const amountMatch = text.match(/(\d[\d\s,.]*)\s*(?:Kč|CZK)/i);
    if (amountMatch) {
      amount = parseFloat(
        amountMatch[1]!.replace(/\s/g, "").replace(",", "."),
      );
    }

    // Determine action type from text
    let actionType = "rozhodnutí";
    if (/pokut/i.test(text)) actionType = "pokuta";
    else if (/odn[eě]t/i.test(text)) actionType = "odnětí licence";
    else if (/omez/i.test(text)) actionType = "omezení činnosti";
    else if (/opat[rř]en[ií]\s+k\s+n[aá]prav/i.test(text))
      actionType = "opatření k nápravě";
    else if (/z[aá]kaz/i.test(text)) actionType = "zákaz činnosti";

    if (firmName.length > 2 && firmName !== "neznámý") {
      actions.push({
        firm_name: firmName,
        reference_number: refMatch ? refMatch[1] ?? null : null,
        action_type: actionType,
        amount,
        date,
        summary: text.slice(0, 1000),
        sourcebook_references: null,
      });
    }
  });

  return actions;
}

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!match) return null;
  const [, d, m, y] = match;
  return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

// ─── De-duplication helper ───────────────────────────────────────────────────

function deduplicateProvisions(provisions: RawProvision[]): RawProvision[] {
  const seen = new Set<string>();
  return provisions.filter((p) => {
    const key = `${p.sourcebook_id}::${p.reference}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Database writes ─────────────────────────────────────────────────────────

function openDb(force: boolean): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (force && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`Deleted existing database at ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

function upsertSourcebooks(
  db: Database.Database,
  sourcebooks: { id: string; name: string; description: string }[],
): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const sb of sourcebooks) {
      stmt.run(sb.id, sb.name, sb.description);
    }
  });
  tx();
}

function insertProvisions(
  db: Database.Database,
  provisions: RawProvision[],
): number {
  const checkStmt = db.prepare(
    "SELECT id FROM provisions WHERE sourcebook_id = ? AND reference = ? LIMIT 1",
  );
  const insertStmt = db.prepare(`
    INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE provisions
    SET title = ?, text = ?, type = ?, status = ?, effective_date = ?, chapter = ?, section = ?
    WHERE sourcebook_id = ? AND reference = ?
  `);

  let inserted = 0;

  const tx = db.transaction(() => {
    for (const p of provisions) {
      const existing = checkStmt.get(p.sourcebook_id, p.reference) as
        | { id: number }
        | undefined;

      if (existing) {
        updateStmt.run(
          p.title,
          p.text,
          p.type,
          p.status,
          p.effective_date,
          p.chapter,
          p.section,
          p.sourcebook_id,
          p.reference,
        );
      } else {
        insertStmt.run(
          p.sourcebook_id,
          p.reference,
          p.title,
          p.text,
          p.type,
          p.status,
          p.effective_date,
          p.chapter,
          p.section,
        );
        inserted++;
      }
    }
  });
  tx();

  return inserted;
}

function insertEnforcements(
  db: Database.Database,
  actions: RawEnforcement[],
): number {
  const checkStmt = db.prepare(
    "SELECT id FROM enforcement_actions WHERE firm_name = ? AND date = ? LIMIT 1",
  );
  const insertStmt = db.prepare(`
    INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;

  const tx = db.transaction(() => {
    for (const e of actions) {
      const existing = checkStmt.get(e.firm_name, e.date) as
        | { id: number }
        | undefined;
      if (existing) continue;

      insertStmt.run(
        e.firm_name,
        e.reference_number,
        e.action_type,
        e.amount,
        e.date,
        e.summary,
        e.sourcebook_references,
      );
      inserted++;
    }
  });
  tx();

  return inserted;
}

// ─── Sourcebook definitions ──────────────────────────────────────────────────

const ALL_SOURCEBOOKS = [
  ...LEGISLATION_CATEGORIES.map((c) => ({
    id: c.id,
    name: c.name,
    description: `Právní předpisy a regulace ČNB v oblasti: ${c.name}. Zahrnuje zákony, vyhlášky, nařízení EU a opatření obecné povahy.`,
  })),
  {
    id: "CNB_VYHLASKY",
    name: "CNB Vyhlášky (Decrees)",
    description:
      "Závazné vyhlášky vydané Českou národní bankou na základě zmocnění v zákonech upravujících finanční trh, zahrnující obezřetnostní požadavky, kapitálovou přiměřenost a vykazovací povinnosti.",
  },
  {
    id: "CNB_UREDNI_SDELENI",
    name: "CNB Úřední sdělení (Official Communications)",
    description:
      "Nezávazná úřední sdělení a výkladová stanoviska ČNB k aplikaci finanční regulace, včetně povinností AML/CFT, požadavků na řízení rizik a dohledových očekávání.",
  },
  {
    id: "CNB_DOHLEDOVE_BENCHMARKY",
    name: "CNB Dohledové benchmarky (Supervisory Benchmarks)",
    description:
      "Dohledové benchmarky ČNB definující kvantitativní a kvalitativní standardy, podle kterých jsou posuzovány dohlížené instituce — řízení rizika likvidity, úrokového rizika, koncentračního rizika a vnitřního kapitálu.",
  },
];

// ─── Phase runners ───────────────────────────────────────────────────────────

async function phaseProvisions(
  db: Database.Database | null,
  flags: CliFlags,
  state: IngestState,
): Promise<number> {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Fáze 1: Předpisy — legislativní základna ČNB");
  console.log("══════════════════════════════════════════════════════\n");

  let allProvisions: RawProvision[] = [];
  let categoriesProcessed = 0;

  const categories = flags.limit > 0
    ? LEGISLATION_CATEGORIES.slice(0, flags.limit)
    : LEGISLATION_CATEGORIES;

  for (const cat of categories) {
    // Skip already-completed categories on resume
    if (flags.resume && state.completedCategories.includes(cat.id)) {
      console.log(`  [přeskočeno] ${cat.name} (dokončeno v předchozím běhu)`);
      continue;
    }

    console.log(`  Zpracovávám: ${cat.name}`);
    console.log(`    URL: ${BASE_URL}${cat.path}`);

    try {
      const html = await fetchWithRetry(`${BASE_URL}${cat.path}`);
      const provisions = parseCategoryPage(html, cat.id);
      console.log(`    Nalezeno: ${provisions.length} předpisů`);

      // Enrich provisions with detail page content where available
      let enriched = 0;
      for (const prov of provisions) {
        if (
          prov.source_url.includes("cnb.cz") &&
          !prov.source_url.endsWith(".pdf") &&
          !prov.source_url.includes("e-sbirka.cz")
        ) {
          const detail = await fetchRegulationDetail(prov.source_url);
          if (detail && detail.length > prov.text.length) {
            prov.text = detail.slice(0, 10_000);
            enriched++;
          }
        }
      }
      if (enriched > 0) {
        console.log(`    Obohaceno: ${enriched} předpisů s detailním textem`);
      }

      allProvisions.push(...provisions);
      state.completedCategories.push(cat.id);
      categoriesProcessed++;

      if (!flags.dryRun) saveState(state);
    } catch (err) {
      console.error(`    CHYBA: ${(err as Error).message}`);
    }
  }

  // Also crawl the official communications page
  console.log(`\n  Zpracovávám: Úřední sdělení — výkon činnosti a obezřetnostní pravidla`);
  try {
    const html = await fetchWithRetry(
      `${BASE_URL}${OFFICIAL_COMMUNICATIONS_PATH}`,
    );
    const ofiProvisions = parseOfficialCommunicationsPage(html);
    console.log(`    Nalezeno: ${ofiProvisions.length} úředních sdělení`);
    allProvisions.push(...ofiProvisions);
  } catch (err) {
    console.error(`    CHYBA: ${(err as Error).message}`);
  }

  allProvisions = deduplicateProvisions(allProvisions);
  console.log(
    `\n  Celkem předpisů (po de-duplikaci): ${allProvisions.length}`,
  );
  console.log(`  Kategorií zpracováno: ${categoriesProcessed}`);

  if (flags.dryRun) {
    console.log("\n  [DRY RUN] Žádná data nebyla zapsána do databáze.");
    return allProvisions.length;
  }

  if (db && allProvisions.length > 0) {
    const inserted = insertProvisions(db, allProvisions);
    state.provisionCount += inserted;
    saveState(state);
    console.log(`  Zapsáno do DB: ${inserted} nových předpisů`);
    return inserted;
  }

  return 0;
}

async function phaseBenchmarks(
  db: Database.Database | null,
  flags: CliFlags,
  state: IngestState,
): Promise<number> {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Fáze 2: Dohledové benchmarky a sdělení");
  console.log("══════════════════════════════════════════════════════\n");

  console.log(`  URL: ${BASE_URL}${BENCHMARKS_PATH}`);

  let provisions: RawProvision[] = [];

  try {
    const html = await fetchWithRetry(`${BASE_URL}${BENCHMARKS_PATH}`);
    provisions = parseBenchmarksPage(html);
    console.log(`  Nalezeno: ${provisions.length} dohledových dokumentů`);
  } catch (err) {
    console.error(`  CHYBA při načítání indexu: ${(err as Error).message}`);
    return 0;
  }

  // Filter out already-processed URLs on resume
  if (flags.resume) {
    const before = provisions.length;
    provisions = provisions.filter(
      (p) => !state.completedBenchmarkUrls.includes(p.source_url),
    );
    if (before !== provisions.length) {
      console.log(
        `  Přeskočeno ${before - provisions.length} již zpracovaných dokumentů`,
      );
    }
  }

  if (flags.limit > 0) {
    provisions = provisions.slice(0, flags.limit);
    console.log(`  Omezeno na: ${provisions.length} dokumentů (--limit)`);
  }

  provisions = deduplicateProvisions(provisions);
  console.log(`  Po de-duplikaci: ${provisions.length} dokumentů`);

  if (flags.dryRun) {
    console.log("\n  [DRY RUN] Žádná data nebyla zapsána do databáze.");
    for (const p of provisions.slice(0, 10)) {
      console.log(`    ${p.reference}: ${p.title?.slice(0, 80)}`);
    }
    if (provisions.length > 10) {
      console.log(`    ... a dalších ${provisions.length - 10}`);
    }
    return provisions.length;
  }

  if (db && provisions.length > 0) {
    const inserted = insertProvisions(db, provisions);
    // Mark processed URLs
    for (const p of provisions) {
      state.completedBenchmarkUrls.push(p.source_url);
    }
    state.provisionCount += inserted;
    saveState(state);
    console.log(`  Zapsáno do DB: ${inserted} nových dohledových dokumentů`);
    return inserted;
  }

  return 0;
}

async function phaseEnforcement(
  db: Database.Database | null,
  flags: CliFlags,
  state: IngestState,
): Promise<number> {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Fáze 3: Pravomocná rozhodnutí (enforcement)");
  console.log("══════════════════════════════════════════════════════\n");

  /**
   * CNB enforcement decisions are behind a search form at:
   *   /cs/dohled-financni-trh/vykon-dohledu/pravomocna-rozhodnuti/
   *   pravomocna-rozhodnuti-cnb-v-rizenich-zahajenych-po-datu-1.1.2009/
   *
   * There are also static pages listing selected decisions outside the
   * capital market area. We crawl those plus the main hub.
   */
  const enforcementPages = [
    {
      label: "Vybraná rozhodnutí mimo kapitálový trh",
      path: "/cs/dohled-financni-trh/vykon-dohledu/pravomocna-rozhodnuti/vybrana-rozhodnuti-mimo-kapitalovy-trh/",
    },
    {
      label: "Rozhodnutí v oblasti kapitálového trhu (do 31.12.2008)",
      path: "/cs/dohled-financni-trh/vykon-dohledu/pravomocna-rozhodnuti/pravomocna-rozhodnuti-v-oblasti-kapitaloveho-trhu-do-31.-12.-2008/",
    },
    {
      label: "Hlavní stránka rozhodnutí",
      path: "/cs/dohled-financni-trh/vykon-dohledu/pravomocna-rozhodnuti/",
    },
  ];

  let allActions: RawEnforcement[] = [];

  const pages = flags.limit > 0
    ? enforcementPages.slice(0, flags.limit)
    : enforcementPages;

  for (const page of pages) {
    const url = `${BASE_URL}${page.path}`;

    if (flags.resume && state.completedEnforcementUrls.includes(url)) {
      console.log(`  [přeskočeno] ${page.label}`);
      continue;
    }

    console.log(`  Zpracovávám: ${page.label}`);
    console.log(`    URL: ${url}`);

    try {
      const html = await fetchWithRetry(url);
      const actions = parseEnforcementListPage(html);
      console.log(`    Nalezeno: ${actions.length} rozhodnutí`);
      allActions.push(...actions);
      state.completedEnforcementUrls.push(url);
    } catch (err) {
      console.error(`    CHYBA: ${(err as Error).message}`);
    }
  }

  console.log(`\n  Celkem rozhodnutí: ${allActions.length}`);

  if (flags.dryRun) {
    console.log("\n  [DRY RUN] Žádná data nebyla zapsána do databáze.");
    for (const a of allActions.slice(0, 10)) {
      console.log(
        `    ${a.firm_name} | ${a.action_type} | ${a.date ?? "neznámé datum"} | ${a.amount > 0 ? `${a.amount} Kč` : "-"}`,
      );
    }
    if (allActions.length > 10) {
      console.log(`    ... a dalších ${allActions.length - 10}`);
    }
    return allActions.length;
  }

  if (db && allActions.length > 0) {
    const inserted = insertEnforcements(db, allActions);
    state.enforcementCount += inserted;
    saveState(state);
    console.log(`  Zapsáno do DB: ${inserted} nových rozhodnutí`);
    return inserted;
  }

  return 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags();
  const state = flags.resume ? loadState() : loadState(); // always load; resume skips completed items

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  CNB Financial Regulation Ingestion Crawler         ║");
  console.log("║  Česká národní banka — cnb.cz                      ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  Databáze:     ${DB_PATH}`);
  console.log(`  Stav:         ${STATE_PATH}`);
  console.log(`  Dry run:      ${flags.dryRun}`);
  console.log(`  Resume:       ${flags.resume}`);
  console.log(`  Force:        ${flags.force}`);
  console.log(`  Fáze:         ${flags.phase}`);
  console.log(`  Limit:        ${flags.limit || "bez omezení"}`);
  console.log(`  Rate limit:   ${RATE_LIMIT_MS}ms`);

  if (flags.force && !flags.dryRun) {
    // Reset state on --force
    state.completedCategories = [];
    state.completedBenchmarkUrls = [];
    state.completedEnforcementUrls = [];
    state.provisionCount = 0;
    state.enforcementCount = 0;
  }

  // Open database (unless dry run)
  let db: Database.Database | null = null;
  if (!flags.dryRun) {
    db = openDb(flags.force);
    upsertSourcebooks(db, ALL_SOURCEBOOKS);
    console.log(`\n  Sourcebooků v DB: ${ALL_SOURCEBOOKS.length}`);
  }

  const startTime = Date.now();
  let totalProvisions = 0;
  let totalEnforcements = 0;

  try {
    // Phase 1: Provisions from legislative foundation
    if (flags.phase === "all" || flags.phase === "provisions") {
      totalProvisions += await phaseProvisions(db, flags, state);
    }

    // Phase 2: Dohledové benchmarky & sdělení
    if (flags.phase === "all" || flags.phase === "benchmarks") {
      totalProvisions += await phaseBenchmarks(db, flags, state);
    }

    // Phase 3: Enforcement actions
    if (flags.phase === "all" || flags.phase === "enforcement") {
      totalEnforcements += await phaseEnforcement(db, flags, state);
    }
  } finally {
    if (db) db.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print summary
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Souhrn");
  console.log("══════════════════════════════════════════════════════\n");

  if (flags.dryRun) {
    console.log("  [DRY RUN] Žádná data nebyla zapsána.");
    console.log(`  Předpisů nalezeno:     ${totalProvisions}`);
    console.log(`  Rozhodnutí nalezeno:   ${totalEnforcements}`);
  } else {
    console.log(`  Předpisů zapsáno:      ${totalProvisions}`);
    console.log(`  Rozhodnutí zapsáno:    ${totalEnforcements}`);

    // Print DB totals
    const dbCheck = new Database(DB_PATH);
    const provCount = (
      dbCheck.prepare("SELECT count(*) as cnt FROM provisions").get() as {
        cnt: number;
      }
    ).cnt;
    const sbCount = (
      dbCheck.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as {
        cnt: number;
      }
    ).cnt;
    const enfCount = (
      dbCheck
        .prepare("SELECT count(*) as cnt FROM enforcement_actions")
        .get() as { cnt: number }
    ).cnt;
    const ftsCount = (
      dbCheck
        .prepare("SELECT count(*) as cnt FROM provisions_fts")
        .get() as { cnt: number }
    ).cnt;
    dbCheck.close();

    console.log(`\n  Stav databáze:`);
    console.log(`    Sourcebooky:         ${sbCount}`);
    console.log(`    Předpisy:            ${provCount}`);
    console.log(`    Rozhodnutí:          ${enfCount}`);
    console.log(`    FTS záznamy:         ${ftsCount}`);
  }

  console.log(`\n  Doba běhu: ${elapsed}s`);
  console.log(`  Databáze: ${DB_PATH}`);
  console.log();
}

main().catch((err) => {
  console.error("\nFatální chyba:", (err as Error).message);
  process.exit(1);
});
