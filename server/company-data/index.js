import { z } from "zod";
import * as defaultProvider from "./provider.js";

const HttpUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Only HTTP(S) source links are allowed");
const Fact = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);
const Facts = z.record(z.string().min(1).max(80), Fact).refine((value) => Object.keys(value).length <= 40, "A record may expose at most 40 facts");

export const CompanyProfile = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  address: z.string().trim().max(500).nullish().transform((value) => value || null),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullish().transform((value) => value || null),
});

export const CompanyRecord = z.object({
  id: z.string().trim().min(1).max(200),
  kind: z.enum(["company", "customer", "product", "service", "pricing", "billing", "order", "project", "other"]),
  label: z.string().trim().min(1).max(240),
  url: HttpUrl.nullish().transform((value) => value || null),
  updatedAt: z.string().datetime({ offset: true }).nullish().transform((value) => value || null),
  facts: Facts,
});

const Context = z.object({
  profile: CompanyProfile.nullable(),
  records: z.array(CompanyRecord).max(25),
});

/**
 * Builds the validated, bounded gateway. Tests inject a fake adapter; production uses provider.js.
 * This is the only object the agent imports, so it never receives a raw database connection.
 */
export function createCompanyDataGateway(provider) {
  const isConfigured = () => {
    try {
      return provider.configured() === true;
    } catch {
      return false;
    }
  };
  return {
    configured: isConfigured,
    describe() {
      let raw = {};
      try {
        raw = provider.describe?.() ?? {};
      } catch {
        // Status stays available even if a teammate's provider is only partially configured.
      }
      return { name: z.string().trim().min(1).max(100).catch("Company database").parse(raw.name) };
    },
    async getContext(input) {
      const query = z.string().trim().min(1).max(1000).parse(input?.query);
      const limit = Math.min(25, Math.max(1, Number(input?.limit) || 20));
      if (!isConfigured()) return { configured: false, profile: null, records: [] };
      const parsed = Context.safeParse(await provider.getContext({ query, limit }));
      if (!parsed.success) throw new Error(`Invalid company data from the provider: ${parsed.error.issues[0]?.message ?? "unknown shape"}`);
      return { configured: true, ...parsed.data, records: parsed.data.records.slice(0, limit) };
    },
  };
}

export const companyData = createCompanyDataGateway(defaultProvider);
