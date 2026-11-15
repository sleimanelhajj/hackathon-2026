// Sales data for the Sales dashboard and the assistant: a small Lebanese solar shop (fictional people and *.example
// addresses), generated from a seed so it's the same every run.
//
// Realistic size for a niche shop: about $10K of sales a month ($120K a year), 10–15 orders a month, 10 products,
// about 25 customers and 4 staff. Orders are built the way a solar shop sells: complete home systems (panels, an
// inverter, batteries, mounting, cable and protection, a few thousand dollars), small add-ons (a few panels, a roll
// of cable, a breaker box), and installers restocking. Every pattern is a story someone could ask about:
//   - Battery boom: 5 kWh lithium batteries sell far more than a year ago and are out of stock.
//   - Bigger systems: 6 kW inverters take over from 3.6 kW ones, which are now overstocked.
//   - Seasons: solar pump kits for farms in summer (and running low), portable power stations in winter.
//   - Customers: Abi Nader Construction stopped ordering 6 months ago; Byblos Bay Apartments joined 4 months ago and
//     is fitting out its building; Khoury Solar Solutions (an installer) is climbing; Haddad Electric is a regular.
//   - Branches: Online grows its share, Jounieh loses its share. Staff: Tarek beats his target, Hiba misses hers.
//   - A few refunds, some unpaid (pending) trade orders, and a handful of open installation quotes.

export const REGIONS = ["Beirut store", "Jounieh store", "Online"];
export const CATEGORIES = ["Solar panels", "Inverters", "Batteries", "Mounting & cabling", "Protection", "Pumps & portable power"];
export const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
const SEGMENTS = { retail: "Retail customer", trade: "Trade account", commercial: "Commercial account" };

/** The shop issuing invoices. Fictional; .example domain. Lebanon: priced in USD, 11% VAT. */
export const STORE_PROFILE = {
  name: "Cedar Solar Supply",
  email: "billing@cedarsolar.example",
  phone: "+961 1 555 014",
  address: "Hamra Street, Ras Beirut, Beirut, Lebanon",
  currency: "USD",
  taxRateBps: 1100, // 11% VAT
  paymentTermsDays: 30,
};

const REPS = [["Nour Azar", "Beirut store"], ["Elie Sarkis", "Beirut store"], ["Hiba Saleh", "Jounieh store"], ["Tarek Fakhoury", "Online"]];
/** Target stretch per person: Tarek's target is easy to beat, Hiba's is hard to reach; the rest land near theirs. */
const TARGET_STRETCH = { "Tarek Fakhoury": 0.8, "Hiba Saleh": 1.3 };

// Demand over time: t goes 0 → 1 across the window; month is the calendar month (0 = Jan).
const DEMAND = {
  rise: (t) => 0.5 + 1.2 * t,
  decline: (t) => 1.4 - 1.1 * t,
  steady: () => 1,
  summer: (_t, month) => ([5, 6, 7, 8].includes(month) ? 3.2 : 0.3),
  winter: (_t, month) => ([11, 0, 1].includes(month) ? 4 : 0.25),
};

// [name, category, brand, unit, price, cost ratio, add-on quantity, add-on weight, demand, stock, reorder level, uses, description]
// SKUs are CH-0001 … CH-0010 in this order; the index constants below name the ones systems are built from.
const PRODUCTS = [
  ["Solar panel 550W (mono)", "Solar panels", "SunLevant", "each", 110, 0.74, 3, 1.4, "rise", 72, 24, ["rooftop solar", "cutting generator bills", "adding panels to a system"], "Monocrystalline 550 W panel; 8 to 12 of them power a typical home system through the day."],
  ["Hybrid inverter 6kW", "Inverters", "VoltCedar", "each", 780, 0.76, 1, 0.25, "rise", 6, 3, ["home solar systems", "running an AC unit", "power cuts"], "6 kW hybrid inverter with a built-in MPPT charger; runs a whole apartment, including one AC unit, from panels and batteries."],
  ["Hybrid inverter 3.6kW", "Inverters", "VoltCedar", "each", 460, 0.75, 1, 0.2, "decline", 19, 3, ["small homes", "power cuts", "lights and fridge"], "3.6 kW hybrid inverter for smaller homes: lights, fridge, internet and a washing machine."],
  ["Lithium battery 5kWh (LiFePO4)", "Batteries", "VoltCedar", "each", 950, 0.78, 1, 0.35, "rise", 0, 4, ["power cuts at night", "storing solar power", "backup power"], "48 V 5 kWh LiFePO4 battery; keeps a home running through the evening power cuts. Stackable."],
  ["Wall battery 2.5kWh (LiFePO4)", "Batteries", "VoltCedar", "each", 520, 0.76, 1, 0.3, "steady", 8, 3, ["small backup", "internet and lights", "offices"], "Slim 2.5 kWh wall battery for small systems and offices; keeps internet, lights and a laptop on."],
  ["Roof mounting kit (4 panels)", "Mounting & cabling", "IronCedar", "kit", 75, 0.55, 1, 0.6, "rise", 34, 10, ["rooftop solar", "flat roofs", "installing panels"], "Aluminium rails, clamps and bolts for four panels on a flat concrete roof."],
  ["PV cable 6 mm² (50 m roll)", "Mounting & cabling", "CableLine", "roll", 58, 0.5, 1, 1.0, "steady", 46, 12, ["wiring panels", "extending a system", "installation"], "UV-resistant red and black solar cable, 50 m; connects the panels on the roof to the inverter."],
  ["DC breaker & surge protection box", "Protection", "SafeArc", "each", 68, 0.5, 1, 0.9, "steady", 28, 8, ["safety", "lightning protection", "installation"], "Pre-wired box with DC breakers and a surge protector between the panels and the inverter."],
  ["Portable power station 1kWh", "Pumps & portable power", "PowerMax", "each", 420, 0.72, 1, 0.7, "winter", 11, 4, ["power cuts", "apartments without a roof", "winter storms"], "1 kWh battery with sockets and a USB charger; runs a router, lights and a laptop through a power cut. No installation."],
  ["Solar water pump kit 1HP", "Pumps & portable power", "AquaSun", "kit", 690, 0.7, 1, 0.5, "summer", 2, 3, ["irrigation", "farms", "wells and water tanks"], "Pump, controller and float switch that run straight from 4 to 6 panels; waters crops and fills tanks in summer."],
];
const P = { panel: 0, inverter6: 1, inverter36: 2, battery5: 3, battery25: 4, mount: 5, cable: 6, protection: 7, station: 8, pump: 9 };

// Customers. [name, segment, industry, branch, weight, { since: months ago they joined | "old", until: months ago they stopped, grows, likes: [product indexes] }]
const CUSTOMERS = [
  // ---- the stories ----
  ["Abi Nader Construction", "trade", "Construction", "Beirut store", 1.4, { since: "old", until: 6, likes: [P.panel, P.mount, P.cable, P.protection] }],
  ["Byblos Bay Apartments", "commercial", "Property management", "Jounieh store", 3.2, { since: 4, likes: [P.panel, P.battery5, P.mount] }],
  ["Khoury Solar Solutions", "trade", "Solar installer", "Beirut store", 1, { since: "old", grows: true, likes: [P.panel, P.inverter6, P.battery5] }],
  ["Haddad Electric", "trade", "Electrical contractor", "Beirut store", 1, { since: "old", likes: [P.cable, P.protection, P.mount] }],
  // ---- trade and commercial accounts ----
  ["Frem Electric", "trade", "Electrical contractor", "Jounieh store", 0.8, { since: "old", likes: [P.protection, P.cable] }],
  ["Daou Solar Services", "trade", "Solar installer", "Online", 0.7, { since: 14, likes: [P.panel, P.mount] }],
  ["Bekaa Valley Farms", "commercial", "Agriculture", "Online", 0.9, { since: 11, likes: [P.pump, P.panel] }],
  ["Cedars Mountain Hotel", "commercial", "Hospitality", "Online", 0.5, { since: "old", likes: [P.battery5, P.inverter6] }],
  ["Hamra Medical Center", "commercial", "Healthcare", "Beirut store", 0.5, { since: "old", likes: [P.battery5, P.battery25] }],
  ["Mar Mikhael Café Co.", "commercial", "Hospitality", "Beirut store", 0.5, { since: "old", likes: [P.battery25, P.station] }],
  // ---- homeowners ----
  ["Karim Haddad", "retail", "Homeowner", "Beirut store", 1, { since: "old" }],
  ["Rania Khoury", "retail", "Homeowner", "Beirut store", 0.9, { since: "old" }],
  ["Joseph Abi Saab", "retail", "Homeowner", "Beirut store", 0.8, { since: 18 }],
  ["Lara Nassar", "retail", "Homeowner", "Beirut store", 0.8, { since: "old" }],
  ["Ziad Chamoun", "retail", "Homeowner", "Beirut store", 0.7, { since: 9 }],
  ["Maya Gemayel", "retail", "Homeowner", "Jounieh store", 1, { since: "old" }],
  ["Fadi Rahme", "retail", "Homeowner", "Jounieh store", 0.8, { since: "old" }],
  ["Christelle Aoun", "retail", "Homeowner", "Jounieh store", 0.7, { since: 12 }],
  ["Rita Tabet", "retail", "Homeowner", "Jounieh store", 0.8, { since: "old" }],
  ["Hassan Zein", "retail", "Homeowner", "Online", 0.8, { since: "old" }],
  ["Yara Fares", "retail", "Homeowner", "Online", 0.9, { since: 10 }],
  ["Omar Itani", "retail", "Homeowner", "Online", 1, { since: 15 }],
  ["Joelle Sfeir", "retail", "Homeowner", "Online", 0.8, { since: 7 }],
  ["Bassam Moukarzel", "retail", "Homeowner", "Online", 0.8, { since: "old" }],
  ["Walid Jaber", "retail", "Homeowner", "Online", 0.9, { since: 3 }],
];

const PLACES = {
  "Beirut store": [["Achrafieh", "Sassine Square"], ["Hamra", "Bliss Street"], ["Mar Mikhael", "Armenia Street"], ["Verdun", "Rashid Karami Street"]],
  "Jounieh store": [["Jounieh", "Fouad Chehab Avenue"], ["Kaslik", "Kaslik Main Road"], ["Byblos", "Old Souk Road"]],
  Online: [["Zahle", "Brazil Street"], ["Tripoli", "Azmi Street"], ["Saida", "Riad El Solh Street"], ["Baalbek", "Ras El Ain Road"]],
};

/** Small, fast, seedable PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const monthStart = (now, back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

/** Shop traffic by calendar month: busier before summer and in the winter power-cut season. */
const SEASON = [1.1, 1.0, 1.0, 1.05, 1.1, 1.15, 1.05, 0.95, 0.9, 0.9, 1.0, 1.15];
/** Branch traffic over time: Online grows, Jounieh shrinks. */
const BRANCH_TREND = { Online: (t) => 0.35 + 1.5 * t, "Jounieh store": (t) => 1.6 - 1.25 * t };
/** Discount by segment: installers get trade prices, accounts a little off, walk-ins now and then. */
const DISCOUNT = { "Trade account": 10, "Commercial account": 5 };

/** The seed the app loads: about $120K over the last 12 months with every story above in it (tests pin it). */
export const DEFAULT_SEED = 22;

export function generateSalesData({ seed = DEFAULT_SEED, months = 24, now = new Date() } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + rand() * (b - a);
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const weighted = (items, weightOf) => {
    const weights = items.map(weightOf);
    let r = rand() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
    return items.at(-1);
  };
  const start = addMonths(now, -months);

  const reps = REPS.map(([name, region], i) => ({ id: i + 1, name, region, monthlyTarget: 0 }));
  const repsByRegion = Object.fromEntries(REGIONS.map((r) => [r, reps.filter((x) => x.region === r)]));

  const products = PRODUCTS.map(([name, category, brand, unit, price, costRatio, qty, weight, demand, stock, reorderLevel, uses, description], i) => ({
    id: i + 1, sku: `CH-${String(i + 1).padStart(4, "0")}`, name, category, brand, unit, description, uses,
    unitPrice: price, unitCost: round2(price * costRatio), stock, reorderLevel, typicalQty: qty, weight, demand: DEMAND[demand],
  }));

  const customers = CUSTOMERS.map(([name, segment, industry, region, weight, story], i) => {
    const [town, street] = pick(PLACES[region]);
    const seg = SEGMENTS[segment];
    const createdAt = story.since === "old"
      ? new Date(start.getTime() - between(60, 700) * 864e5)
      : new Date(monthStart(now, story.since).getTime() + between(1, 12) * 864e5);
    return {
      id: i + 1, name, region, industry, segment: seg, weight, story,
      email: segment === "retail" ? `${slug(name)}@mail.example` : `accounts@${slug(name)}.example`,
      phone: segment === "retail" ? `+961 ${pick(["3", "70", "71", "76", "81"])} ${100 + Math.floor(rand() * 899)} ${100 + Math.floor(rand() * 899)}`
        : `+961 ${pick(["1", "4", "8", "9"])} ${100 + Math.floor(rand() * 899)} ${100 + Math.floor(rand() * 899)}`,
      address: `${1 + Math.floor(rand() * 120)} ${street}, ${town}, Lebanon`,
      createdAt,
      endsAt: story.until ? monthStart(now, story.until - 1) : null, // e.g. until 6: no orders from 5 months ago onwards
    };
  });

  /**
   * A complete system: panels with roof mounts, a hybrid inverter (6 kW more and more often), batteries (5 kWh more
   * and more often), cable and protection. `scale` makes it bigger for buildings and installers' jobs.
   */
  const system = (t, scale) => {
    const panels = Math.round(int(6, 10) * scale);
    const lines = [[P.panel, panels], [P.mount, Math.ceil(panels / 4)], [P.cable, Math.max(1, Math.round(scale))], [P.protection, 1]];
    lines.push([rand() < 0.2 + 0.7 * t ? P.inverter6 : P.inverter36, Math.max(1, Math.round(scale * 0.8))]);
    const batteries = Math.max(1, Math.round(between(1, 2) * scale));
    lines.push([rand() < 0.15 + 0.8 * t * t ? P.battery5 : P.battery25, batteries]);
    return lines;
  };
  /** A small purchase: one or two products, weighted by what sells this month and what this customer likes. */
  const addOn = (t, month, likes, size) => {
    const lines = [];
    const count = rand() < 0.75 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const p = weighted(products, (x) => x.weight * x.demand(t, month) * (likes.has(x.id - 1) ? 4 : 1));
      lines.push([p.id - 1, Math.max(1, Math.round(p.typicalQty * size * between(0.7, 1.3)))]);
    }
    return lines;
  };

  // Orders month by month.
  const orders = [];
  const orderItems = [];
  let number = 60000;
  for (let m = 0; m < months; m++) {
    const t = months > 1 ? m / (months - 1) : 1;
    const from = addMonths(start, m);
    const to = m === months - 1 ? now : addMonths(start, m + 1);
    const calendarMonth = from.getUTCMonth();
    const count = Math.round(7 * Math.pow(1.025, m) * SEASON[calendarMonth] * between(0.85, 1.15));
    for (let k = 0; k < count; k++) {
      const orderedAt = new Date(from.getTime() + rand() * (to.getTime() - from.getTime()));
      const active = customers.filter((c) => c.createdAt <= orderedAt && (!c.endsAt || orderedAt < c.endsAt));
      if (!active.length) continue;
      const customer = weighted(active, (c) => c.weight * (BRANCH_TREND[c.region]?.(t) ?? 1) * (c.story.grows ? 0.3 + 1.6 * t : 1));
      const rep = pick(repsByRegion[customer.region]);
      const trade = customer.segment !== SEGMENTS.retail;
      const recentDays = (now.getTime() - orderedAt.getTime()) / 864e5;
      const r = rand();
      const status = trade && recentDays < 21 && r < 0.4 ? "pending" : !trade && r < 0.03 ? "refunded" : "paid";
      const channel = customer.region === "Online" ? (r < 0.75 ? "Online" : "Phone order") : trade ? (r < 0.6 ? "Trade counter" : "Phone order") : "In store";
      const order = { id: orders.length + 1, number: `CH-${++number}`, customerId: customer.id, repId: rep.id, orderedAt, status, channel };
      orders.push(order);

      const likes = new Set(customer.story.likes ?? []);
      const lines = customer.segment === SEGMENTS.trade
        ? (rand() < 0.17 ? system(t, between(1, 1.4)) : addOn(t, calendarMonth, likes, 2))
        : customer.segment === SEGMENTS.commercial
          ? (rand() < 0.2 ? system(t, between(1.2, 1.6)) : addOn(t, calendarMonth, likes, 1.5))
          : (rand() < 0.12 ? system(t, 1) : addOn(t, calendarMonth, likes, 1));
      const merged = new Map();
      for (const [index, quantity] of lines) merged.set(index, (merged.get(index) ?? 0) + quantity);
      const discountPct = DISCOUNT[customer.segment] ?? (rand() < 0.1 ? 5 : 0);
      for (const [index, quantity] of merged) {
        orderItems.push({ orderId: order.id, productId: index + 1, quantity, unitPrice: products[index].unitPrice, discountPct });
      }
    }
  }

  // Staff targets: what each person sold over the last six months, with a small stretch (rounded to $250).
  const orderValue = new Map();
  for (const it of orderItems) orderValue.set(it.orderId, (orderValue.get(it.orderId) ?? 0) + it.quantity * it.unitPrice * (1 - it.discountPct / 100));
  const cut = addMonths(now, -6);
  const recentByRep = new Map();
  for (const o of orders) if (o.orderedAt >= cut && o.status !== "refunded") recentByRep.set(o.repId, (recentByRep.get(o.repId) ?? 0) + orderValue.get(o.id));
  for (const rep of reps) {
    const base = ((recentByRep.get(rep.id) ?? 0) / 6) * between(0.94, 1.06) * (TARGET_STRETCH[rep.name] ?? 1);
    rep.monthlyTarget = Math.max(500, Math.round(base / 250) * 250);
  }

  // Installation quotes (the pipeline), for trade and commercial accounts only. Older ones are closed; recent ones open.
  const accounts = customers.filter((c) => c.segment !== SEGMENTS.retail && !c.endsAt);
  const jobs = [
    ["home system 5 kW", 3500, 5500], ["home system 8 kW", 5500, 8500], ["battery upgrade", 1800, 3800],
    ["farm irrigation pump", 2200, 4200], ["building common areas", 7000, 14000], ["clinic backup power", 4500, 9000],
  ];
  const deals = [];
  const quote = (createdAt, forceOpen) => {
    const customer = pick(accounts);
    const rep = pick(repsByRegion[customer.region]);
    const ageDays = (now.getTime() - createdAt.getTime()) / 864e5;
    let stage, closedAt = null;
    if (!forceOpen && rand() < Math.min(0.95, ageDays / 60)) {
      stage = rand() < 0.45 ? "won" : "lost";
      closedAt = new Date(Math.min(now.getTime(), createdAt.getTime() + between(3, Math.max(4, Math.min(ageDays, 40))) * 864e5));
    } else {
      stage = STAGES[Math.floor(Math.pow(rand(), 1.3) * 4)];
    }
    const [job, low, high] = pick(jobs);
    const amount = Math.round(between(low, high) / 50) * 50;
    deals.push({
      id: deals.length + 1, name: `${customer.name} – ${job}`, customerId: customer.id, repId: rep.id, stage, amount, createdAt, closedAt,
      expectedClose: closedAt ?? new Date(createdAt.getTime() + between(7, 40) * 864e5),
    });
  };
  for (let i = 0; i < 20; i++) quote(new Date(start.getTime() + Math.pow(rand(), 0.8) * (now.getTime() - start.getTime() - 40 * 864e5)), false);
  for (let i = 0; i < 6; i++) quote(new Date(now.getTime() - between(1, 35) * 864e5), true);

  return {
    profile: { ...STORE_PROFILE },
    reps,
    customers: customers.map(({ weight, story, endsAt, ...c }) => c),
    products: products.map(({ typicalQty, weight, demand, ...p }) => p),
    orders, orderItems, deals,
  };
}
