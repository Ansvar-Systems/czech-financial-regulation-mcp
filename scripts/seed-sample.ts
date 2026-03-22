/**
 * Seed the CNB database with sample provisions for testing.
 *
 * Inserts representative provisions from CNB_Vyhlasky, CNB_Uredni_Sdeleni,
 * and CNB_Dohledove_Benchmarky sourcebooks so MCP tools can be tested
 * without running a full data ingestion pipeline.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["CNB_DB_PATH"] ?? "data/cnb.db";
const force = process.argv.includes("--force");

// ── Bootstrap database ───────────────────────────────────────────────────────

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// ── Sourcebooks ──────────────────────────────────────────────────────────────

interface SourcebookRow {
  id: string;
  name: string;
  description: string;
}

const sourcebooks: SourcebookRow[] = [
  {
    id: "CNB_VYHLASKY",
    name: "CNB Vyhlasky (Decrees)",
    description:
      "Binding decrees issued by the Czech National Bank under delegated authority from Czech financial legislation, covering prudential requirements, capital adequacy, and reporting obligations for credit institutions, investment firms, and insurance companies.",
  },
  {
    id: "CNB_UREDNI_SDELENI",
    name: "CNB Uredni sdeleni (Official Communications)",
    description:
      "Non-binding official communications and interpretive guidance issued by the CNB on the application of financial regulation, including AML/CFT obligations, risk management expectations, and supervisory expectations for regulated entities.",
  },
  {
    id: "CNB_DOHLEDOVE_BENCHMARKY",
    name: "CNB Dohledove benchmarky (Supervisory Benchmarks)",
    description:
      "CNB supervisory benchmarks defining quantitative and qualitative standards against which supervised institutions are assessed, covering liquidity risk, interest rate risk, credit risk concentration, and internal capital adequacy assessment.",
  },
];

const insertSourcebook = db.prepare(
  "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
);

for (const sb of sourcebooks) {
  insertSourcebook.run(sb.id, sb.name, sb.description);
}

console.log(`Inserted ${sourcebooks.length} sourcebooks`);

// ── Sample provisions ────────────────────────────────────────────────────────

interface ProvisionRow {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string;
  chapter: string;
  section: string;
}

const provisions: ProvisionRow[] = [
  // ── CNB Vyhlasky — Prudential requirements ──────────────────────────────
  {
    sourcebook_id: "CNB_VYHLASKY",
    reference: "Vyhlaska c. 163/2014 Sb.",
    title: "Vyhlaska o vykonu cinnosti bank, sporitelních a uverních druzstev a obchodniku s cennymi papiry",
    text: "Tato vyhlaska stanovi pozadavky na vykon cinnosti uvérovych institucí a obchodniku s cennymi papiry, vcetne pozadavku na vnitrní ridící a kontrolní system, rízení rizik, odmenovani a na prubezné plnení podmínek pro udelení povolení. Uverová instituce je povinna zavést a udrzovat spolehlivé strategie, postupy a mechanismy pro rízení rizik, jimz je nebo muze být vystavena.",
    type: "vyhlaska",
    status: "in_force",
    effective_date: "2014-09-01",
    chapter: "1",
    section: "1",
  },
  {
    sourcebook_id: "CNB_VYHLASKY",
    reference: "Vyhlaska c. 163/2014 Sb., par. 6",
    title: "Vnitrní ridící a kontrolní system",
    text: "Uverová instituce zavede a udrZuje vnitrní ridící a kontrolní system, ktery zahrnuje: a) organizacní usporadání s jasnymi vymezením pravomocí a odpovedností, b) efektivní procesy pro identifikaci, rízení, sledování a vykazování rizik, c) primerenné mechanismy vnitrní kontroly, d) system odmenovani, ktery je v souladu s rádnym a efektivním rízením rizik. Správní nebo dozorcí organ uverové instituce schvaluje a prubezne priezkoumává strategie a politiky pro podstupování, rízení, sledování a snizování rizik.",
    type: "vyhlaska",
    status: "in_force",
    effective_date: "2014-09-01",
    chapter: "2",
    section: "6",
  },
  {
    sourcebook_id: "CNB_VYHLASKY",
    reference: "Vyhlaska c. 273/2023 Sb.",
    title: "Vyhlaska o kapitalovych pozadavcích a zpusobilych závazcích",
    text: "Tato vyhlaska provadi prislusná ustanovení zákona o bankách a zákona o sporitelních a uverních druzstvech tykající se kapitalovych pozadavku. Uverová instituce prubezne splnuje pozadavky na kapital a zpusobile závazky stanovené v narízení Evropského parlamentu a Rady (EU) c. 575/2013. Kombinovaná kapitálová rezerva zahrnuje kapitálovou rezervu pro zachování kapitálu, proticyklickou kapitálovou rezervu, rezervu ke krytí systemového rizika a kapitálové rezervy pro systemove vyznamné instituce.",
    type: "vyhlaska",
    status: "in_force",
    effective_date: "2023-07-01",
    chapter: "1",
    section: "1",
  },
  {
    sourcebook_id: "CNB_VYHLASKY",
    reference: "Vyhlaska c. 344/2022 Sb.",
    title: "Vyhlaska o predkladání vykazu pojistovnami a zajistovnami Ceské národní bance",
    text: "Pojistovny a zajistovny jsou povinny predkladat Ceské národní bance vykazy o své financní situaci a solventnosti podle této vyhlasky. Vykaz o solventnosti a financní situaci (SFCR) se zverejnuje nejméne jednou rocne. Pojistovna nebo zajistovna predklada rovnez pravidelné zprávy dohledovym organum (RSR) zahrnující kvantitativní vykaznictví Solventnost II.",
    type: "vyhlaska",
    status: "in_force",
    effective_date: "2023-01-01",
    chapter: "1",
    section: "1",
  },
  // ── CNB Uredni sdeleni — AML and risk management guidance ──────────────
  {
    sourcebook_id: "CNB_UREDNI_SDELENI",
    reference: "US CNB 2022/1",
    title: "Uredni sdelení CNB k systému vnitrní kontroly a rízení rizik praní penez a financování terorismu",
    text: "Ceská národní banka vydává toto urední sdelení za úcelem upcesnení svych dohledovych ocekávání ohledne systému vnitrní kontroly a rízení rizik v oblasti predcházení praní penez a financování terorismu (AML/CFT). Povinná osoba je povinna vyhodnocovat rizika praní penez a financování terorismu, jimz je vystavena, a prijmout primeraná opatrení k jejich rízení. System vnitrní kontroly musí zahrnovat politiky, postupy a kontroly zamerené na identifikaci a overení totoZnosti klientu, sledování obchodních vztahu a oznamování podezrelych obchodu.",
    type: "uredni sdelení",
    status: "in_force",
    effective_date: "2022-03-01",
    chapter: "1",
    section: "1",
  },
  {
    sourcebook_id: "CNB_UREDNI_SDELENI",
    reference: "US CNB 2021/3",
    title: "Uredni sdelení CNB k rízení operacního rizika",
    text: "Toto urední sdelení shrnuje dohledová ocekávání CNB v oblasti rízení operacního rizika úverových institucí a obchodniku s cennymi papiry. Instituce je povinna mít zavedeny robustní rámec pro identifikaci, hodnocení, sledování, rízení a zmírnovani operacního rizika. Rámec zahrnuje politiku rízení operacního rizika schválenou správním organem, postupy pro sber a analyzu dat o ztrátech z operacního rizika, scénárovou analyzu a plánování kontinuity podnikání. CNB ocekává, ze instituce venuji zvlástní pozornost rizikum spojenym s informacními technologiemi, kybernetické bezpecnosti a outsourcingem klícovych funkcí.",
    type: "uredni sdelení",
    status: "in_force",
    effective_date: "2021-06-15",
    chapter: "1",
    section: "3",
  },
  {
    sourcebook_id: "CNB_UREDNI_SDELENI",
    reference: "US CNB 2023/2",
    title: "Uredni sdelení CNB k ESG rizikum a udrzitelnosti v bankovním sektoru",
    text: "Ceská národní banka ocekává, ze úverové instituce zaclenní environmentální, sociální a správní (ESG) rizika do svého celkového rámce pro rízení rizik a do procesu hodnocení primeranosti vnitrního kapitálu (ICAAP). Instituce by mely identifikovat a kvantifikovat fyzická rizika i prechodová rizika spojená se zmenou klimatu. CNB bude posuzovat primerenost prístupu institucí k ESG rizikum v rámci dohledového hodnocení (SREP) a ocekává postupné zlepsování metodik a zverejnování informací v souladu s evropskymi standardy.",
    type: "uredni sdelení",
    status: "in_force",
    effective_date: "2023-04-01",
    chapter: "1",
    section: "2",
  },
  // ── CNB Dohledove benchmarky — Supervisory standards ───────────────────
  {
    sourcebook_id: "CNB_DOHLEDOVE_BENCHMARKY",
    reference: "DB CNB 2023/LR-01",
    title: "Dohledovy benchmark pro rízení rizika likvidity",
    text: "Tento benchmark stanovi dohledová ocekávání CNB pro rízení rizika likvidity v úverových institucích. Instituce musí splnovat regulatorní ukazatele likvidity stanovené narízením CRR: ukazatel krytí likvidity (LCR) nejméne 100 % a ukazatel cistého stabilního financování (NSFR) nejméne 100 %. Nad rámec regulatorních minimálních pozadavku CNB ocekává, ze instituce budou provádét vlastní hodnocení primerenosti likvidity (ILAAP) zahrnující analyzu zatezového testování, plán financování pro prípad nouze a vyhodnocení rizika koncentrace zdroju financování.",
    type: "dohledovy benchmark",
    status: "in_force",
    effective_date: "2023-01-01",
    chapter: "1",
    section: "LR-01",
  },
  {
    sourcebook_id: "CNB_DOHLEDOVE_BENCHMARKY",
    reference: "DB CNB 2023/KR-02",
    title: "Dohledovy benchmark pro koncentracní riziko úverového portfolia",
    text: "Benchmark definuje standardy pro identifikaci, merení a rízení koncentracního rizika v úverových portfoliích. Instituce musí dodrzovat limity pro angazovanost vuci jedné osobe nebo ekonomicky spjaté skupine osob (neprekracující 25 % kapitálu tier 1). CNB ocekává, ze instituce mají zavedené vnitrní limity pro sektorovou, geografickou a produktovou koncentraci. Zatézové testování musí zahrnovat scénáre s materializací koncentracního rizika. Správní organ je odpovedny za schválení a pravidelné priezkoumání politiky pro rízení koncentracního rizika.",
    type: "dohledovy benchmark",
    status: "in_force",
    effective_date: "2023-01-01",
    chapter: "1",
    section: "KR-02",
  },
  {
    sourcebook_id: "CNB_DOHLEDOVE_BENCHMARKY",
    reference: "DB CNB 2022/UR-01",
    title: "Dohledovy benchmark pro úrokové riziko bankovní knihy (IRRBB)",
    text: "Tento benchmark vymezuje dohledová ocekávání CNB pro merení a rízení úrokového rizika bankovní knihy (IRRBB). Instituce musí merit citlivost ekonomické hodnoty vlastního kapitálu (EVE) a cistého úrokového príjmu (NII) vuci standardizovanym sokovym scénárum definovanym EBA. Pokud EVE poklesne o více nez 15 % tier 1 kapitálu v rámci standardizovaného soku, podléhá instituce zvysenému dohledovému zájmu. Instituce je povinna zahrnout IRRBB do procesu ICAAP a provádét pravidelné zatezové testování.",
    type: "dohledovy benchmark",
    status: "in_force",
    effective_date: "2022-07-01",
    chapter: "1",
    section: "UR-01",
  },
];

const insertProvision = db.prepare(`
  INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const p of provisions) {
    insertProvision.run(
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
  }
});

insertAll();

console.log(`Inserted ${provisions.length} sample provisions`);

// ── Sample enforcement actions ───────────────────────────────────────────────

interface EnforcementRow {
  firm_name: string;
  reference_number: string;
  action_type: string;
  amount: number;
  date: string;
  summary: string;
  sourcebook_references: string;
}

const enforcements: EnforcementRow[] = [
  {
    firm_name: "Banka Creditas a.s.",
    reference_number: "CNB/2022/SP-001",
    action_type: "fine",
    amount: 5_000_000,
    date: "2022-11-14",
    summary:
      "CNB ulozila Bance Creditas a.s. pokutu za zjistené nedostatky v systemu vnitrní kontroly AML/CFT. Banka neprijala primeraná opatrení ke zmírnovani rizik praní penez u skupiny klientu vykazujících nestandardní transakcní chování. Nedostatky zahrnovaly chybející nebo nedostatecné záznamy o prubezném sledování obchodního vztahu a pozdní oznamování podezrelych obchodu Financnímu analytickému uradu.",
    sourcebook_references: "US CNB 2022/1",
  },
  {
    firm_name: "XY Investicní spolecnost a.s.",
    reference_number: "CNB/2023/SP-002",
    action_type: "restriction",
    amount: 0,
    date: "2023-06-30",
    summary:
      "CNB ulozila XY Investicní spolecnosti a.s. opatrení k náprave a omezení cinnosti spocívající v zákazu sjednávání novych smluv se zákazníky na dobu sesti mesícu. Duvodem bylo opakované porusení pravidel jednání se zákazníky, zejména nedostatecné posuzování primeranosti investic, neposkytování pozadovanych informací zákazníkum a nedostatky v systemu rízení stretu zájmu.",
    sourcebook_references: "Vyhlaska c. 163/2014 Sb., par. 6",
  },
];

const insertEnforcement = db.prepare(`
  INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertEnforcementsAll = db.transaction(() => {
  for (const e of enforcements) {
    insertEnforcement.run(
      e.firm_name,
      e.reference_number,
      e.action_type,
      e.amount,
      e.date,
      e.summary,
      e.sourcebook_references,
    );
  }
});

insertEnforcementsAll();

console.log(`Inserted ${enforcements.length} sample enforcement actions`);

// ── Summary ──────────────────────────────────────────────────────────────────

const provisionCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions").get() as { cnt: number }
).cnt;
const sourcebookCount = (
  db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as { cnt: number }
).cnt;
const enforcementCount = (
  db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as { cnt: number }
).cnt;
const ftsCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as { cnt: number }
).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Sourcebooks:          ${sourcebookCount}`);
console.log(`  Provisions:           ${provisionCount}`);
console.log(`  Enforcement actions:  ${enforcementCount}`);
console.log(`  FTS entries:          ${ftsCount}`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
