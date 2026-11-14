// The chatbot never receives a raw database client or query language. A teammate maps the real
// company database into this small, bounded contract.
import assert from "node:assert/strict";
import test from "node:test";

const { createCompanyDataGateway } = await import("../../server/company-data/index.js");

const profile = { name: "Northwind Studio", email: "billing@northwind.example", address: "1 Harbour Road", defaultCurrency: "USD" };
const source = {
  id: "customer-14",
  kind: "customer",
  label: "Lena Ortiz · customer record",
  url: "https://company.example/customers/14",
  updatedAt: "2026-11-14T09:00:00.000Z",
  facts: { customerName: "Lena Ortiz", email: "lena@ortiz.example", active: true },
};

test("bounds company-data searches and validates normalized records", async () => {
  const seen = [];
  const gateway = createCompanyDataGateway({
    configured: () => true,
    describe: () => ({ name: "Test company database" }),
    async getContext(args) {
      seen.push(args);
      return { profile, records: [source] };
    },
  });
  const result = await gateway.getContext({ query: "Lena's current pricing", limit: 999 });
  assert.deepEqual(seen, [{ query: "Lena's current pricing", limit: 25 }]);
  assert.equal(result.profile.name, "Northwind Studio");
  assert.deepEqual(result.records, [source]);
});

test("rejects unsafe source links and oversized fact values from an adapter", async () => {
  const gateway = createCompanyDataGateway({
    configured: () => true,
    describe: () => ({ name: "Broken adapter" }),
    async getContext() {
      return { profile, records: [{ ...source, url: "javascript:alert(1)", facts: { note: "x".repeat(3000) } }] };
    },
  });
  await assert.rejects(() => gateway.getContext({ query: "test", limit: 10 }), /invalid company data/i);
});

test("an unconnected provider returns an honest empty context", async () => {
  const gateway = createCompanyDataGateway({
    configured: () => false,
    describe: () => ({ name: "Company database" }),
    async getContext() { throw new Error("must not run"); },
  });
  const result = await gateway.getContext({ query: "anything", limit: 10 });
  assert.deepEqual(result, { configured: false, profile: null, records: [] });
});
