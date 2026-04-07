#!/usr/bin/env node

/**
 * Czech Financial Regulation MCP — stdio entry point.
 *
 * Provides MCP tools for querying CNB (Česká národní banka) regulations:
 * vyhlášky (decrees), úřední sdělení (official communications),
 * dohledové benchmarky (supervisory benchmarks), and enforcement actions.
 *
 * Tool prefix: cz_fin_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "czech-financial-regulation-mcp";

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "cz_fin_search_regulations",
    description:
      "Full-text search across CNB (Česká národní banka) regulatory provisions. Returns matching vyhlášky (decrees), úřední sdělení (official communications), and dohledové benchmarky (supervisory benchmarks). Supports Czech-language queries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query in Czech or English (e.g., 'kapitálové požadavky', 'AML', 'řízení rizik')",
        },
        sourcebook: {
          type: "string",
          description: "Filter by sourcebook ID (e.g., CNB_VYHLASKY, CNB_UREDNI_SDELENI, CNB_DOHLEDOVE_BENCHMARKY). Optional.",
        },
        status: {
          type: "string",
          enum: ["in_force", "deleted", "not_yet_in_force"],
          description: "Filter by provision status. Defaults to all statuses.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "cz_fin_get_regulation",
    description:
      "Get a specific CNB provision by sourcebook and reference. Accepts references like 'Vyhláška č. 163/2014 Sb.' or 'ÚS 2023/1'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourcebook: {
          type: "string",
          description: "Sourcebook identifier (e.g., CNB_VYHLASKY, CNB_UREDNI_SDELENI, CNB_DOHLEDOVE_BENCHMARKY)",
        },
        reference: {
          type: "string",
          description: "Full provision reference (e.g., 'Vyhláška č. 163/2014 Sb.', 'ÚS 2023/1')",
        },
      },
      required: ["sourcebook", "reference"],
    },
  },
  {
    name: "cz_fin_list_sourcebooks",
    description:
      "List all CNB regulatory sourcebooks with their names and descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "cz_fin_search_enforcement",
    description:
      "Search CNB enforcement actions — sanctions, fines, licence revocations, and restrictions issued against regulated entities.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., entity name, type of breach, 'AML', 'praní peněz')",
        },
        action_type: {
          type: "string",
          enum: ["fine", "ban", "restriction", "warning"],
          description: "Filter by action type. Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "cz_fin_check_currency",
    description:
      "Check whether a specific CNB provision reference is currently in force. Returns status and effective date.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "Full provision reference to check (e.g., 'Vyhláška č. 163/2014 Sb.')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "cz_fin_about",
    description: "Return metadata about this MCP server: version, data source, tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Zod schemas for argument validation ────────────────────────────────────

const SearchRegulationsArgs = z.object({
  query: z.string().min(1),
  sourcebook: z.string().optional(),
  status: z.enum(["in_force", "deleted", "not_yet_in_force"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetRegulationArgs = z.object({
  sourcebook: z.string().min(1),
  reference: z.string().min(1),
});

const SearchEnforcementArgs = z.object({
  query: z.string().min(1),
  action_type: z.enum(["fine", "ban", "restriction", "warning"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const CheckCurrencyArgs = z.object({
  reference: z.string().min(1),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function textContent(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// ─── Server setup ────────────────────────────────────────────────────────────

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "cz_fin_search_regulations": {
        const parsed = SearchRegulationsArgs.parse(args);
        const results = searchProvisions({
          query: parsed.query,
          sourcebook: parsed.sourcebook,
          status: parsed.status,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length });
      }

      case "cz_fin_get_regulation": {
        const parsed = GetRegulationArgs.parse(args);
        const provision = getProvision(parsed.sourcebook, parsed.reference);
        if (!provision) {
          return errorContent(
            `Provision not found: ${parsed.sourcebook} ${parsed.reference}`,
          );
        }
        const prov = provision as Record<string, unknown>;
        return textContent({
          ...prov,
          _citation: buildCitation(
            String(prov.reference ?? parsed.reference),
            String(prov.title ?? prov.reference ?? parsed.reference),
            "cz_fin_get_regulation",
            { sourcebook: parsed.sourcebook, reference: parsed.reference },
            prov.url != null ? String(prov.url) : undefined,
          ),
        });
      }

      case "cz_fin_list_sourcebooks": {
        const sourcebooks = listSourcebooks();
        return textContent({ sourcebooks, count: sourcebooks.length });
      }

      case "cz_fin_search_enforcement": {
        const parsed = SearchEnforcementArgs.parse(args);
        const results = searchEnforcement({
          query: parsed.query,
          action_type: parsed.action_type,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length });
      }

      case "cz_fin_check_currency": {
        const parsed = CheckCurrencyArgs.parse(args);
        const currency = checkProvisionCurrency(parsed.reference);
        return textContent(currency);
      }

      case "cz_fin_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "Czech National Bank (CNB / Česká národní banka) financial regulation MCP server. Provides access to CNB vyhlášky (decrees), úřední sdělení (official communications), dohledové benchmarky (supervisory benchmarks), and enforcement actions.",
          data_source: "CNB regulatory publications (https://www.cnb.cz/)",
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`);
  }
});

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
