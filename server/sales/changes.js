// Updating the business records through the assistant (decision #68). Layla can propose any change to the sales
// database: new or edited customers and products, a new sale (an invoice: revenue, stock down), a supplier purchase
// (a cost: stock up), a running expense (rent, salaries…), an order's status, quotes, staff targets and shop settings.
//
// Three steps, never fewer:
//   propose(tool, args) → a draft: exactly what will change (before → after), with warnings. Nothing is written.
//   apply(draft)        → only after the user pressed Save in the chat; one transaction; logged in record_changes.
//   undo(id)            → puts it back, unless the record changed again since (then it says so instead).
// Sales and purchases go through inventory.js applyInvoice, the same path as emailed invoices, so stock, revenue and
// the Sales page's Undo stay consistent. The model only fills in arguments; every value is checked here.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SCHEMA } from "./db.js";
import { applyInvoice, undoInvoice } from "../inventory.js";
import { ACCOUNT_DISCOUNT_PCT } from "../agent/sales-tools.js";

export const EXPENSE_CATEGORIES = ["Rent", "Salaries", "Utilities", "Transport", "Marketing", "Maintenance", "Fees & taxes", "Supplies", "Other"];
const SEGMENTS = ["Retail customer", "Trade account", "Commercial account"];
const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
const CONFIRM = "The user sees exactly what will change and must confirm before anything is saved; nothing is written by this call.";

// ---------------------------------------------------------------- what the model is told
const S = (description) => ({ type: "STRING", description });
const N = (description) => ({ type: "NUMBER", description });
const I = (description) => ({ type: "INTEGER", description });
const B = (description) => ({ type: "BOOLEAN", description });
const tool = (name, description, properties, required = []) => ({ name, description: `${description} ${CONFIRM}`, parameters: { type: "OBJECT", properties, required } });
const CUSTOMER_FIELDS = {
  segment: { type: "STRING", enum: ["retail", "trade", "commercial"], description: "retail = homeowner/walk-in, trade = installer/contractor (5% off), commercial = business account (10% off)" },
  branch: S("Which branch serves them: Beirut store, Jounieh store or Online"), industry: S("e.g. Homeowner, Solar installer, Agriculture, Hospitality"),
  email: S("Email address"), phone: S("Phone number with country code"), address: S("Postal address"),
};
const PRODUCT_FIELDS = {
  category: S("Product category, e.g. Solar panels, Inverters, Batteries, Mounting & cabling, Protection, Pumps & portable power"),
  unitPrice: N("Selling price per unit in USD, before VAT"), unitCost: N("What one unit costs the shop in USD"),
  reorderLevel: I("Reorder when stock falls to this level"), brand: S("Brand"), unit: S("each, kit, roll, pack…"),
  description: S("One or two sentences for customers"), uses: S("What it's for, comma separated"),
};
const LINE = (priceField, priceText) => ({
  type: "ARRAY", description: "One entry per product",
  items: { type: "OBJECT", properties: { product: S("SKU (e.g. CH-0004) or exact product name"), quantity: I("Whole number of units"), [priceField]: N(priceText) }, required: ["product", "quantity"] },
});

export const CHANGE_DECLARATIONS = [
  tool("propose_new_customer", "Propose adding a new customer.", { name: S("Customer or company name"), ...CUSTOMER_FIELDS }, ["name"]),
  tool("propose_customer_update", "Propose changing an existing customer's details (name, segment, branch, industry, email, phone, address).",
    { customer: S("Customer id or name"), name: S("New name"), ...CUSTOMER_FIELDS }, ["customer"]),
  tool("propose_new_product", "Propose adding a new product to the catalogue. It gets the next SKU.",
    { name: S("Product name"), ...PRODUCT_FIELDS, stock: I("Units in stock now (default 0)") }, ["name", "category", "unitPrice", "unitCost"]),
  tool("propose_product_update", "Propose changing a product: price, cost, stock (a counted number, or stockChange to add or remove units), reorder level, name, category, brand, unit, description.",
    { product: S("SKU or name"), name: S("New name"), ...PRODUCT_FIELDS, stock: I("Counted stock: the new number of units"), stockChange: I("Units to add (positive) or remove (negative)") }, ["product"]),
  tool("propose_sale", "Propose recording a sale (a new invoice): adds the revenue as an order and lowers stock. Prices default to the list price with the customer's account discount.",
    { customer: S("Customer id or name"), lines: LINE("unitPrice", "Price per unit if different from the list price"), date: S("YYYY-MM-DD, default today"), number: S("Invoice number if they have one"), paid: B("true if already paid, otherwise it is recorded as unpaid") }, ["customer", "lines"]),
  tool("propose_purchase", "Propose recording a purchase from a supplier (a cost of stock): raises stock and records what it cost.",
    { supplier: S("Supplier name"), lines: LINE("unitCost", "Cost per unit if different from the product's usual cost"), date: S("YYYY-MM-DD, default today"), number: S("The supplier's invoice number") }, ["supplier", "lines"]),
  tool("propose_expense", "Propose recording a running cost that isn't stock: rent, salaries, utilities, transport, marketing, maintenance, fees & taxes, supplies or other.",
    { category: { type: "STRING", enum: EXPENSE_CATEGORIES, description: "Kind of cost" }, amount: N("Amount in USD"), date: S("YYYY-MM-DD, default today"), description: S("What it was for"), payee: S("Who was paid"), branch: S("Branch it belongs to, if any") }, ["category", "amount"]),
  tool("propose_order_status", "Propose changing an order's status: mark it paid, pending (unpaid) or refunded.",
    { order: S("Order number, e.g. CH-60229"), status: { type: "STRING", enum: ["paid", "pending", "refunded"], description: "New status" } }, ["order", "status"]),
  tool("propose_quote", "Propose a new trade quote, or a change to one (stage, amount, expected close). Give quote to change an existing one; omit it to create one.",
    { quote: S("Quote id or name, to change an existing quote"), customer: S("Customer id or name, for a new quote"), name: S("What the job is"), amount: N("Quote value in USD"),
      stage: { type: "STRING", enum: STAGES, description: "Stage" }, expectedClose: S("YYYY-MM-DD"), staff: S("Staff member handling it") }),
  tool("propose_staff_target", "Propose a new monthly sales target for a staff member.", { staff: S("Staff member's name"), monthlyTarget: N("Monthly target in USD") }, ["staff", "monthlyTarget"]),
  tool("propose_store_settings", "Propose changing the shop's details used on invoices: name, email, phone, address, sales tax rate, payment terms.",
    { name: S("Shop name"), email: S("Billing email"), phone: S("Phone"), address: S("Address"), taxRatePct: N("Sales tax in percent, e.g. 11"), paymentTermsDays: I("Days to pay an invoice") }),
];
export const CHANGE_TOOL_NAMES = new Set(CHANGE_DECLARATIONS.map((d) => d.name));

/** The expenses read tool (answers "what did we spend on rent?"). */
export const EXPENSES_DECLARATION = {
  name: "expenses_summary",
  description: "Running costs that aren't stock (rent, salaries, utilities…) over the last N calendar months (1 = this month so far): total, by category, by month and the latest entries.",
  parameters: { type: "OBJECT", properties: { months: I("1-24, default 3") } },
};

// ---------------------------------------------------------------- argument checks
const text = (max = 200) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const money = z.coerce.number().refine((v) => Number.isFinite(v) && v > 0 && v < 10_000_000, "must be a positive amount");
const count = z.coerce.number().int("must be a whole number").min(0).max(1_000_000);
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date like 2026-11-15").optional();
const lines = (priceKey) => z.array(z.object({ product: z.string().trim().min(1), quantity: z.coerce.number().int("quantities are whole numbers").min(1).max(10_000), [priceKey]: money.optional() }))
  .min(1, "add at least one product").max(30);
const ARGS = {
  propose_new_customer: z.object({ name: z.string().trim().min(2).max(120), segment: text(), branch: text(), industry: text(60), email: text(120), phone: text(40), address: text(200) }),
  propose_customer_update: z.object({ customer: z.coerce.string().trim().min(1), name: text(120), segment: text(), branch: text(), industry: text(60), email: text(120), phone: text(40), address: text(200) }),
  propose_new_product: z.object({ name: z.string().trim().min(2).max(120), category: z.string().trim().min(2).max(60), unitPrice: money, unitCost: money, stock: count.optional(), reorderLevel: count.optional(), brand: text(60), unit: text(20), description: text(400), uses: z.union([z.string(), z.array(z.string())]).optional() }),
  propose_product_update: z.object({ product: z.string().trim().min(1), name: text(120), category: text(60), unitPrice: money.optional(), unitCost: money.optional(), stock: count.optional(), stockChange: z.coerce.number().int().min(-1_000_000).max(1_000_000).optional(), reorderLevel: count.optional(), brand: text(60), unit: text(20), description: text(400), uses: z.union([z.string(), z.array(z.string())]).optional() }),
  propose_sale: z.object({ customer: z.coerce.string().trim().min(1), lines: lines("unitPrice"), date: day, number: text(40), paid: z.coerce.boolean().optional() }),
  propose_purchase: z.object({ supplier: z.string().trim().min(2).max(120), lines: lines("unitCost"), date: day, number: text(40) }),
  propose_expense: z.object({ category: z.string().trim().min(1), amount: money, date: day, description: text(200), payee: text(120), branch: text(60) }),
  propose_order_status: z.object({ order: z.string().trim().min(1), status: z.enum(["paid", "pending", "refunded"]) }),
  propose_quote: z.object({ quote: z.coerce.string().trim().optional(), customer: z.coerce.string().trim().optional(), name: text(120), amount: money.optional(), stage: z.enum(STAGES).optional(), expectedClose: day, staff: text(80) }),
  propose_staff_target: z.object({ staff: z.string().trim().min(1), monthlyTarget: money }),
  propose_store_settings: z.object({ name: text(120), email: text(120), phone: text(40), address: text(200), taxRatePct: z.coerce.number().min(0).max(50).optional(), paymentTermsDays: count.max(365).optional() }),
};

class ChangeError extends Error {}
const fail = (message) => { throw new ChangeError(message); };
const round2 = (n) => Math.round(n * 100) / 100;
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const listText = (names) => names.slice(0, 5).join(", ") + (names.length > 5 ? "…" : "");
const usesText = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => s.trim()).filter(Boolean).join(", ") || undefined;
const dateOf = (v, now) => (v ? new Date(`${v}T12:00:00Z`) : now);

function segmentOf(v) {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (/retail|home|walk/.test(s)) return "Retail customer";
  if (/trade|install|contract|electric/.test(s)) return "Trade account";
  if (/commercial|business|company|account/.test(s)) return "Commercial account";
  return fail(`"${v}" isn't a customer type. Use retail, trade or commercial.`);
}
function expenseCategory(v) {
  const s = v.toLowerCase().replace(/[^a-z]/g, "");
  const hit = EXPENSE_CATEGORIES.find((c) => c.toLowerCase().replace(/[^a-z]/g, "").startsWith(s) || s.startsWith(c.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5)));
  return hit ?? fail(`"${v}" isn't an expense category. Use one of: ${EXPENSE_CATEGORIES.join(", ")}.`);
}

// ---------------------------------------------------------------- records and their columns
const ENTITY = {
  customers: { label: "customer", cols: { name: ["Name", "text"], segment: ["Segment", "text"], region: ["Branch", "text"], industry: ["Industry", "text"], email: ["Email", "text"], phone: ["Phone", "text"], address: ["Address", "text"] } },
  products: { label: "product", cols: { name: ["Name", "text"], category: ["Category", "text"], unit_price: ["Price", "num"], unit_cost: ["Cost", "num"], stock: ["Stock", "int"], reorder_level: ["Reorder level", "int"], brand: ["Brand", "text"], unit: ["Unit", "text"], description: ["Description", "text"], uses: ["Used for", "text"] } },
  orders: { label: "order", cols: { status: ["Status", "text"] } },
  deals: { label: "quote", cols: { name: ["Quote", "text"], stage: ["Stage", "text"], amount: ["Amount", "num"], expected_close: ["Expected close", "date"], closed_at: ["Closed", "date"] } },
  reps: { label: "staff member", cols: { monthly_target: ["Monthly target", "num"] } },
  store_profile: { label: "shop settings", cols: { name: ["Shop name", "text"], email: ["Email", "text"], phone: ["Phone", "text"], address: ["Address", "text"], tax_rate_bps: ["Tax rate (%)", "bps"], payment_terms_days: ["Payment terms (days)", "int"] } },
};
/** A value as stored in the log: numbers as numbers, dates as ISO strings, empty as null. */
const norm = (v, type) => (v == null || v === "" ? null : type === "num" || type === "int" || type === "bps" ? Number(v) : type === "date" ? new Date(v).toISOString() : String(v));
/** How a value is shown in the draft. */
const shown = (v, type) => (v == null ? null : type === "bps" ? v / 100 : type === "date" ? String(v).slice(0, 10) : v);
const same = (a, b) => (a == null && b == null) || String(a) === String(b);

export function createChangeDesk({ pool, schema = DEFAULT_SCHEMA, now = () => new Date() }) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  const s = `"${schema}"`;
  const rows = async (sql, params = []) => (await pool.query(sql.replaceAll("$S", s), params)).rows;

  async function inTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn({ rows: async (sql, params = []) => (await client.query(sql.replaceAll("$S", s), params)).rows });
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** One record by id, or by a name that only one record fits (exact first, then contains). */
  async function findOne({ table, label, ref, nameCol = "name", extra = "" }) {
    const r = String(ref ?? "").trim();
    if (!r) fail(`Say which ${label}.`);
    if (/^\d+$/.test(r)) {
      const [hit] = await rows(`SELECT * FROM $S.${table} WHERE id = $1`, [Number(r)]);
      if (hit) return hit;
    }
    const exact = await rows(`SELECT * FROM $S.${table} WHERE lower(${nameCol}) = lower($1) ${extra} ORDER BY id LIMIT 2`, [r]);
    if (exact.length === 1) return exact[0];
    const like = await rows(`SELECT * FROM $S.${table} WHERE ${nameCol} ILIKE $1 ${extra} ORDER BY id LIMIT 6`, [`%${r.replace(/[%_]/g, "")}%`]);
    if (like.length === 1) return like[0];
    if (!like.length) fail(`There's no ${label} called "${r}". Check the name${label === "customer" ? ", or add them first" : ""}.`);
    return fail(`More than one ${label} matches "${r}": ${listText(like.map((x) => x[nameCol]))}. Which one?`);
  }
  async function findProduct(ref) {
    const r = String(ref).trim();
    const [bySku] = await rows(`SELECT * FROM $S.products WHERE upper(sku) = upper($1)`, [r]);
    return bySku ?? findOne({ table: "products", label: "product", ref: r });
  }
  async function branches() {
    return (await rows(`SELECT DISTINCT region FROM $S.reps UNION SELECT DISTINCT region FROM $S.customers ORDER BY 1`)).map((x) => x.region);
  }
  async function branchOf(v) {
    if (!v) return undefined;
    const list = await branches();
    const hit = list.find((b) => b.toLowerCase() === v.toLowerCase()) ?? list.find((b) => b.toLowerCase().startsWith(v.toLowerCase().split(" ")[0]));
    return hit ?? fail(`"${v}" isn't a branch. Use one of: ${list.join(", ")}.`);
  }

  /** before → after for the columns that really change. */
  function diff(entity, current, next) {
    const cols = ENTITY[entity].cols;
    const set = {}, before = {}, fields = [];
    for (const [col, value] of Object.entries(next)) {
      if (value === undefined) continue;
      const [label, type] = cols[col];
      const from = norm(current?.[col], type), to = norm(value, type);
      if (current && same(from, to)) continue;
      set[col] = to;
      before[col] = from;
      fields.push({ label, before: current ? shown(from, type) : null, after: shown(to, type) });
    }
    return { set, before, fields };
  }
  const draft = (d) => ({ id: randomUUID(), warnings: [], ...d });
  const update = (entity, row, next, title, target, warnings = []) => {
    const { set, before, fields } = diff(entity, row, next);
    if (!fields.length) fail(`There's nothing to change: the ${ENTITY[entity].label} already has those details.`);
    return draft({ kind: `${entity}_update`, entity, entityId: String(row.id), title, target, fields, warnings, payload: { set, before } });
  };

  // ---------------------------------------------------------------- propose
  const proposers = {
    async propose_new_customer(a) {
      const segment = segmentOf(a.segment) ?? "Retail customer";
      const region = (await branchOf(a.branch)) ?? "Online";
      const warnings = [];
      const dupes = await rows(`SELECT id, name FROM $S.customers WHERE lower(name) = lower($1)`, [a.name]);
      if (dupes.length) warnings.push(`A customer called ${dupes[0].name} already exists (id ${dupes[0].id}).`);
      if (!a.branch) warnings.push("No branch was given, so they're filed under Online.");
      if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) fail(`"${a.email}" doesn't look like an email address.`);
      const values = { name: a.name, segment, region, industry: a.industry ?? (segment === "Retail customer" ? "Homeowner" : "Unknown"), email: a.email, phone: a.phone, address: a.address };
      const { set, fields } = diff("customers", null, values);
      return draft({ kind: "new_customer", entity: "customers", title: "Add a new customer", target: a.name, fields, warnings, payload: { set } });
    },
    async propose_customer_update(a) {
      const row = await findOne({ table: "customers", label: "customer", ref: a.customer });
      if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) fail(`"${a.email}" doesn't look like an email address.`);
      return update("customers", row, { name: a.name, segment: segmentOf(a.segment), region: await branchOf(a.branch), industry: a.industry, email: a.email, phone: a.phone, address: a.address }, "Update a customer", row.name);
    },
    async propose_new_product(a) {
      const warnings = [];
      if (a.unitCost >= a.unitPrice) warnings.push(`The cost is above the price (${usd(a.unitCost)} vs ${usd(a.unitPrice)}): every sale would lose money.`);
      const cats = (await rows(`SELECT DISTINCT category FROM $S.products`)).map((x) => x.category);
      const category = cats.find((c) => c.toLowerCase() === a.category.toLowerCase()) ?? a.category;
      if (!cats.includes(category)) warnings.push(`"${category}" is a new category.`);
      const dupes = await rows(`SELECT sku, name FROM $S.products WHERE lower(name) = lower($1)`, [a.name]);
      if (dupes.length) warnings.push(`${dupes[0].name} already exists as ${dupes[0].sku}.`);
      const sku = await nextSku();
      const values = { name: a.name, category, unit_price: round2(a.unitPrice), unit_cost: round2(a.unitCost), stock: a.stock ?? 0, reorder_level: a.reorderLevel ?? 0, brand: a.brand, unit: a.unit ?? "each", description: a.description, uses: usesText(a.uses) };
      const { set, fields } = diff("products", null, values);
      return draft({ kind: "new_product", entity: "products", title: "Add a new product", target: a.name, fields: [{ label: "SKU", before: null, after: sku }, ...fields], warnings, payload: { set } });
    },
    async propose_product_update(a) {
      const row = await findProduct(a.product);
      if (a.stock !== undefined && a.stockChange !== undefined) fail("Give either the counted stock or a change in stock, not both.");
      const stock = a.stockChange !== undefined ? Number(row.stock ?? 0) + a.stockChange : a.stock;
      if (stock !== undefined && stock < 0) fail(`That would leave ${stock} in stock; stock can't go below zero.`);
      const price = a.unitPrice ?? Number(row.unit_price), cost = a.unitCost ?? Number(row.unit_cost);
      const warnings = cost >= price ? [`The cost (${usd(cost)}) is not below the price (${usd(price)}): every sale would lose money.`] : [];
      return update("products", row, { name: a.name, category: a.category, unit_price: a.unitPrice && round2(a.unitPrice), unit_cost: a.unitCost && round2(a.unitCost), stock, reorder_level: a.reorderLevel, brand: a.brand, unit: a.unit, description: a.description, uses: a.uses && usesText(a.uses) },
        "Update a product", row.name, warnings);
    },
    async propose_sale(a) {
      const customer = await findOne({ table: "customers", label: "customer", ref: a.customer });
      const discount = ACCOUNT_DISCOUNT_PCT[customer.segment] ?? 0;
      const warnings = [];
      const out = [];
      for (const line of a.lines) {
        const p = await findProduct(line.product);
        const unitPrice = round2(line.unitPrice ?? Number(p.unit_price) * (1 - discount / 100));
        if (Number(p.stock ?? 0) < line.quantity) warnings.push(`${p.name}: ${p.stock ?? 0} in stock, ${line.quantity} sold; stock would go below zero.`);
        out.push({ sku: p.sku, name: p.name, quantity: line.quantity, unitPrice, amount: round2(unitPrice * line.quantity) });
      }
      if (discount && a.lines.some((l) => l.unitPrice === undefined)) warnings.push(`${customer.segment}: ${discount}% account discount applied to list prices.`);
      const number = a.number ?? (await nextOrderNumber());
      const taken = await rows(`SELECT 1 FROM $S.orders WHERE number = $1`, [number]);
      if (taken.length) fail(`Invoice ${number} is already recorded.`);
      const date = dateOf(a.date, now());
      if (date > new Date(now().getTime() + 86_400_000)) warnings.push("The date is in the future.");
      const total = round2(out.reduce((n, l) => n + l.amount, 0));
      return draft({
        kind: "sale", entity: "invoice", title: "Record a sale", target: customer.name, number, lines: out, total,
        fields: [{ label: "Invoice", before: null, after: number }, { label: "Date", before: null, after: date.toISOString().slice(0, 10) }, { label: "Paid", before: null, after: a.paid ? "Yes" : "Not yet" }],
        warnings, payload: { customerId: customer.id, customer: customer.name, number, date: date.toISOString(), paid: Boolean(a.paid), lines: out, total },
      });
    },
    async propose_purchase(a) {
      const out = [];
      for (const line of a.lines) {
        const p = await findProduct(line.product);
        const unitCost = round2(line.unitCost ?? Number(p.unit_cost));
        out.push({ sku: p.sku, name: p.name, quantity: line.quantity, unitPrice: unitCost, amount: round2(unitCost * line.quantity) });
      }
      const date = dateOf(a.date, now());
      const total = round2(out.reduce((n, l) => n + l.amount, 0));
      return draft({
        kind: "purchase", entity: "invoice", title: "Record a purchase", target: a.supplier, number: a.number ?? null, lines: out, total,
        fields: [{ label: "Supplier invoice", before: null, after: a.number ?? "(none)" }, { label: "Date", before: null, after: date.toISOString().slice(0, 10) }],
        warnings: a.number ? [] : ["No supplier invoice number: the same purchase entered twice would count twice."],
        payload: { supplier: a.supplier, number: a.number ?? null, date: date.toISOString(), lines: out, total },
      });
    },
    async propose_expense(a) {
      const category = expenseCategory(a.category);
      const date = dateOf(a.date, now());
      const branch = await branchOf(a.branch);
      const fields = [
        { label: "Category", before: null, after: category }, { label: "Amount", before: null, after: round2(a.amount) }, { label: "Date", before: null, after: date.toISOString().slice(0, 10) },
        ...(a.description ? [{ label: "For", before: null, after: a.description }] : []), ...(a.payee ? [{ label: "Paid to", before: null, after: a.payee }] : []), ...(branch ? [{ label: "Branch", before: null, after: branch }] : []),
      ];
      return draft({ kind: "new_expense", entity: "expenses", title: "Record an expense", target: `${category}, ${usd(a.amount)}`, fields, total: round2(a.amount),
        payload: { set: { category, amount: round2(a.amount), spent_at: date.toISOString(), description: a.description ?? null, payee: a.payee ?? null, branch: branch ?? null } } });
    },
    async propose_order_status(a) {
      const [row] = await rows(`SELECT * FROM $S.orders WHERE upper(number) = upper($1)`, [a.order]);
      if (!row) fail(`There's no order ${a.order}.`);
      return update("orders", row, { status: a.status }, "Change an order's status", row.number);
    },
    async propose_quote(a) {
      const closing = (stage) => (stage === "won" || stage === "lost" ? now().toISOString() : stage ? null : undefined);
      if (a.quote) {
        const row = await findOne({ table: "deals", label: "quote", ref: a.quote });
        return update("deals", row, { name: a.name, amount: a.amount, stage: a.stage, expected_close: a.expectedClose && dateOf(a.expectedClose, now()).toISOString(), closed_at: a.stage ? closing(a.stage) : undefined }, "Update a quote", row.name);
      }
      if (!a.customer || !a.name || !a.amount) fail("For a new quote, give the customer, what the job is, and its amount.");
      const customer = await findOne({ table: "customers", label: "customer", ref: a.customer });
      if (customer.segment === "Retail customer") fail(`${customer.name} is a retail customer; quotes are for trade and commercial accounts.`);
      const rep = a.staff ? await findOne({ table: "reps", label: "staff member", ref: a.staff }) : (await rows(`SELECT * FROM $S.reps ORDER BY (region = $1) DESC, id LIMIT 1`, [customer.region]))[0];
      const stage = a.stage ?? "lead";
      const expected = a.expectedClose ? dateOf(a.expectedClose, now()) : new Date(now().getTime() + 30 * 86_400_000);
      return draft({
        kind: "new_quote", entity: "deals", title: "Add a quote", target: `${customer.name} – ${a.name}`, total: round2(a.amount),
        fields: [{ label: "Customer", before: null, after: customer.name }, { label: "Quote", before: null, after: a.name }, { label: "Amount", before: null, after: round2(a.amount) },
          { label: "Stage", before: null, after: stage }, { label: "Staff", before: null, after: rep.name }, { label: "Expected close", before: null, after: expected.toISOString().slice(0, 10) }],
        payload: { set: { name: `${customer.name} – ${a.name}`.slice(0, 160), customer_id: customer.id, rep_id: rep.id, stage, amount: round2(a.amount), created_at: now().toISOString(), expected_close: expected.toISOString(), closed_at: closing(stage) ?? null } },
      });
    },
    async propose_staff_target(a) {
      const row = await findOne({ table: "reps", label: "staff member", ref: a.staff });
      return update("reps", row, { monthly_target: round2(a.monthlyTarget) }, "Change a monthly target", row.name);
    },
    async propose_store_settings(a) {
      const [row] = await rows(`SELECT * FROM $S.store_profile WHERE id = 1`);
      if (!row) fail("The shop's details aren't set up yet. Load the sales records on the Sales page first.");
      if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) fail(`"${a.email}" doesn't look like an email address.`);
      return update("store_profile", row, { name: a.name, email: a.email, phone: a.phone, address: a.address, tax_rate_bps: a.taxRatePct === undefined ? undefined : Math.round(a.taxRatePct * 100), payment_terms_days: a.paymentTermsDays }, "Change the shop's settings", row.name);
    },
  };

  async function nextSku() {
    const [{ n }] = await rows(`SELECT coalesce(max(substring(sku FROM '\\d+$')::int), 0) + 1 AS n FROM $S.products WHERE sku ~ '^CH-\\d+$'`);
    return `CH-${String(n).padStart(4, "0")}`;
  }
  async function nextOrderNumber() {
    const [{ n }] = await rows(`SELECT coalesce(max(substring(number FROM '^CH-(\\d+)$')::int), 60000) + 1 AS n FROM $S.orders`);
    return `CH-${n}`;
  }

  /** A draft of what would change. Throws a plain-words error when the request doesn't hold up. */
  async function propose(name, args) {
    const schemaFor = ARGS[name];
    if (!schemaFor) fail(`Unknown change "${name}".`);
    const parsed = schemaFor.safeParse(args ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(`${issue.path.join(".") || "Input"}: ${issue.message}`.replace(/^unitPrice/, "price").replace(/^unitCost/, "cost"));
    }
    return proposers[name](parsed.data);
  }

  // ---------------------------------------------------------------- apply
  const logChange = (db, d, extra) => db.rows(
    `INSERT INTO $S.record_changes (id, kind, title, target, entity, entity_id, before, after, invoice_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [d.id, d.kind, d.title, d.target, d.entity, extra.entityId ?? d.entityId ?? null, extra.before === undefined ? null : JSON.stringify(extra.before), extra.after === undefined ? null : JSON.stringify(extra.after), extra.invoiceKey ?? null]);

  async function insertRow(db, table, set) {
    await db.rows(`LOCK TABLE $S.${table} IN EXCLUSIVE MODE`);
    const extra = {};
    if (table === "customers") extra.created_at = now().toISOString();
    if (table === "products") extra.sku = await (async () => {
      const [{ n }] = await db.rows(`SELECT coalesce(max(substring(sku FROM '\\d+$')::int), 0) + 1 AS n FROM $S.products WHERE sku ~ '^CH-\\d+$'`);
      return `CH-${String(n).padStart(4, "0")}`;
    })();
    const values = { ...set, ...extra };
    if (table !== "expenses") {
      const [{ next }] = await db.rows(`SELECT coalesce(max(id), 0) + 1 AS next FROM $S.${table}`);
      values.id = next;
    }
    const cols = Object.keys(values);
    const [row] = await db.rows(`INSERT INTO $S.${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, cols.map((c) => values[c]));
    return { id: row.id, values };
  }

  /** Saves a confirmed draft. Returns what the chat shows: a sentence, and the id to undo it with. */
  async function apply(d) {
    if (!d?.id || !d.kind) fail("That change can't be saved: it's incomplete. Ask for it again.");
    const [seen] = await rows(`SELECT 1 FROM $S.record_changes WHERE id = $1`, [d.id]);
    if (seen) fail("That change was already saved.");

    if (d.kind === "sale" || d.kind === "purchase") {
      const p = d.payload;
      const out = await applyInvoice({
        kind: d.kind, number: p.number, counterparty: d.kind === "sale" ? p.customer : p.supplier, customerId: p.customerId ?? null,
        date: p.date, currency: "USD", total: p.total, source: "assistant", sourceId: d.id,
        lines: p.lines.map((l) => ({ sku: l.sku, description: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
      }, { pool, schema });
      if (!out.applied) fail(out.reason === "already applied" ? `That ${d.kind} is already recorded.` : "That couldn't be recorded.");
      if (d.kind === "sale" && p.paid) await rows(`UPDATE $S.orders SET status = 'paid' WHERE id = (SELECT order_id FROM $S.invoice_changes WHERE key = $1)`, [out.key]);
      await inTransaction((db) => logChange(db, d, { invoiceKey: out.key, after: { total: p.total, lines: p.lines.length } }));
      const summary = d.kind === "sale"
        ? `Sale ${p.number} recorded for ${p.customer}: ${usd(p.total)}${p.paid ? ", paid" : ", not paid yet"}. Stock went down.`
        : `Purchase from ${p.supplier} recorded: ${usd(p.total)}. Stock went up.`;
      return { applied: true, id: d.id, kind: d.kind, title: d.title, target: d.target, summary };
    }

    return inTransaction(async (db) => {
      if (d.kind.startsWith("new_")) {
        const { id, values } = await insertRow(db, d.entity, d.payload.set);
        await logChange(db, d, { entityId: String(id), after: values });
        const what = d.kind === "new_product" ? `${values.name} added as ${values.sku}` : d.kind === "new_customer" ? `${values.name} added as a customer` : d.kind === "new_expense" ? `${values.category} expense of ${usd(values.amount)} recorded` : `Quote added: ${values.name}`;
        return { applied: true, id: d.id, kind: d.kind, title: d.title, target: d.target, summary: `${what}.` };
      }
      // An edit: only if the record still looks the way the draft showed it.
      const { set, before } = d.payload;
      const cols = Object.keys(set);
      const key = d.entity === "store_profile" ? 1 : Number(d.entityId);
      const [current] = await db.rows(`SELECT ${cols.join(", ")} FROM $S.${d.entity} WHERE id = $1 FOR UPDATE`, [key]);
      if (!current) fail(`That ${ENTITY[d.entity].label} no longer exists.`);
      for (const c of cols) if (!same(norm(current[c], ENTITY[d.entity].cols[c][1]), before[c])) fail(`The ${ENTITY[d.entity].label} changed since this draft was made. Ask for the change again.`);
      await db.rows(`UPDATE $S.${d.entity} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1}`, [...cols.map((c) => set[c]), key]);
      await logChange(db, d, { entityId: String(key), before, after: set });
      return { applied: true, id: d.id, kind: d.kind, title: d.title, target: d.target, summary: `Saved for ${d.target}: ${d.fields.map((f) => `${f.label} ${f.after ?? "(empty)"}`).join(", ")}.` };
    });
  }

  // ---------------------------------------------------------------- undo
  const REFERENCES = {
    customers: [["orders", "customer_id"], ["deals", "customer_id"]],
    products: [["order_items", "product_id"], ["purchase_items", "product_id"], ["stock_movements", "product_id"]],
  };
  async function undo(id) {
    const [change] = await rows(`SELECT * FROM $S.record_changes WHERE id = $1`, [String(id)]);
    if (!change) fail("That change isn't in the log.");
    if (change.undone_at) fail("That change was already undone.");
    if (change.invoice_key) {
      await undoInvoice(change.invoice_key, { pool, schema });
      await rows(`UPDATE $S.record_changes SET undone_at = now() WHERE id = $1`, [change.id]);
      return { undone: true, id: change.id, summary: `${change.title} undone: ${change.target}.` };
    }
    return inTransaction(async (db) => {
      const key = Number(change.entity_id);
      if (!change.before) {
        for (const [table, col] of REFERENCES[change.entity] ?? []) {
          const [{ n }] = await db.rows(`SELECT count(*)::int AS n FROM $S.${table} WHERE ${col} = $1`, [key]);
          if (n) fail(`Can't undo: this ${ENTITY[change.entity]?.label ?? "record"} is now used by ${n} ${table.replace(/_/g, " ")}.`);
        }
        await db.rows(`DELETE FROM $S.${change.entity} WHERE id = $1`, [key]);
      } else {
        const cols = Object.keys(change.before);
        const [current] = await db.rows(`SELECT ${cols.join(", ")} FROM $S.${change.entity} WHERE id = $1 FOR UPDATE`, [key]);
        if (!current) fail("That record no longer exists.");
        for (const c of cols) if (!same(norm(current[c], ENTITY[change.entity].cols[c][1]), change.after[c])) fail("Can't undo: it changed again after this change. Undo the later change first, or ask for a new change.");
        await db.rows(`UPDATE $S.${change.entity} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1}`, [...cols.map((c) => change.before[c]), key]);
      }
      await db.rows(`UPDATE $S.record_changes SET undone_at = now() WHERE id = $1`, [change.id]);
      return { undone: true, id: change.id, summary: `${change.title} undone: ${change.target}.` };
    });
  }

  /** The latest changes, newest first. */
  async function recent({ limit = 20 } = {}) {
    const list = await rows(`SELECT id, kind, title, target, applied_at, undone_at FROM $S.record_changes ORDER BY applied_at DESC LIMIT $1`, [Math.max(1, Math.min(100, limit))]);
    return list.map((r) => ({ id: r.id, kind: r.kind, title: r.title, target: r.target, appliedAt: r.applied_at, undoneAt: r.undone_at, canUndo: !r.undone_at }));
  }

  /** Running costs over the last N calendar months (1 = this month so far). */
  async function expensesSummary({ months = 3 } = {}) {
    const m = Math.max(1, Math.min(24, Number(months) || 3));
    const t = now();
    const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - (m - 1), 1));
    const list = await rows(`SELECT category, amount::float AS amount, spent_at, description, payee, branch FROM $S.expenses WHERE spent_at >= $1 AND spent_at <= $2 ORDER BY spent_at DESC`, [from, t]);
    const by = (key) => [...list.reduce((acc, e) => acc.set(key(e), round2((acc.get(key(e)) ?? 0) + e.amount)), new Map())];
    return {
      period: { from: from.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10), months: m }, currency: "USD",
      total: round2(list.reduce((n, e) => n + e.amount, 0)),
      byCategory: by((e) => e.category).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      byMonth: by((e) => new Date(e.spent_at).toISOString().slice(0, 7)).map(([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month)),
      latest: list.slice(0, 10).map((e) => ({ date: new Date(e.spent_at).toISOString().slice(0, 10), category: e.category, amount: e.amount, description: e.description, payee: e.payee, branch: e.branch })),
    };
  }

  return { propose, apply, undo, recent, expensesSummary };
}

/** What the model is told about a draft: enough to talk about it; it can't alter what will be saved. */
export const changeSummary = (d) => ({
  status: "shown to the user to confirm; wait for them", title: d.title, target: d.target,
  changes: d.fields.map((f) => (f.before == null ? `${f.label}: ${f.after}` : `${f.label}: ${f.before} → ${f.after}`)),
  ...(d.lines ? { lines: d.lines.map((l) => `${l.quantity} × ${l.name} at $${l.unitPrice}`), total: d.total } : {}), warnings: d.warnings,
});

/** The draft as the chat shows it (no internal payload). */
export const publicDraft = ({ payload: _payload, ...d }) => d;
export { ChangeError };
