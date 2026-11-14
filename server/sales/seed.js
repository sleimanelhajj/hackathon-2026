// Demo sales data for the Sales dashboard and the assistant. Everything here is FICTIONAL and labelled as sample data
// in the UI (AGENTS.md rule 2): an invented Lebanese hardware store, its branches, staff, customers and products,
// generated from a seed so it's the same every run.
//
// It is deliberately small (10 products, ~40 customers, ~1,700 orders over 24 months) so a person can read it, and
// every pattern in it is a story someone could ask about:
//   - Solar boom: inverter batteries and solar panels grow fast; batteries are out of stock.
//   - Generators decline as solar replaces them, and they're overstocked.
//   - Seasons: heaters in winter, water pumps in summer (water shortages), paint in spring/summer, tool sets at Christmas.
//   - Steady sellers: LED bulbs and PVC pipe (bought in bulk by plumbers). The cordless drill grows slowly, low on stock.
//   - Customers: Abi Nader Construction stopped ordering 6 months ago; Byblos Bay Apartments joined 4 months ago and buys
//     a lot; Khoury Solar Solutions is climbing with the solar boom; Haddad Plumbing is a steady regular.
//   - Branches: Online grows its share, Saida loses its share. Staff: Tarek beats his target, Hiba misses hers.
//   - A few refunds, some unpaid (pending) trade orders, and a pipeline of trade quotes.

export const REGIONS = ["Beirut store", "Jounieh store", "Byblos store", "Saida store", "Online"];
export const CATEGORIES = ["Solar & power", "Power tools", "Hand tools", "Plumbing", "Electrical", "Paint & supplies"];
export const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
const SEGMENTS = { retail: "Retail customer", trade: "Trade account", commercial: "Commercial account" };

/** The store issuing invoices. Fictional; .example domain. Lebanon: priced in USD, 11% VAT. */
export const STORE_PROFILE = {
  name: "Cedar Hardware & Supply",
  email: "billing@cedarhardware.example",
  phone: "+961 1 555 014",
  address: "Hamra Street, Ras Beirut, Beirut, Lebanon",
  currency: "USD",
  taxRateBps: 1100, // 11% VAT
  paymentTermsDays: 30,
};

const REPS = [
  ["Nour Azar", "Beirut store"], ["Elie Sarkis", "Beirut store"], ["Maya Tannous", "Jounieh store"],
  ["Georges Rizk", "Byblos store"], ["Hiba Saleh", "Saida store"], ["Tarek Fakhoury", "Online"],
];
/** Target stretch per person: Tarek's target is easy to beat, Hiba's is hard to reach; the rest land near theirs. */
const TARGET_STRETCH = { "Tarek Fakhoury": 0.8, "Hiba Saleh": 1.3 };

// Demand over time: t goes 0 → 1 across the window; month is the calendar month (0 = Jan).
const DEMAND = {
  boom: (t) => 0.25 + 2.2 * t * t,
  rise: (t) => 0.3 + 1.8 * t,
  decline: (t) => 1.5 - 1.3 * t,
  steady: () => 1,
  slowGrowth: (t) => 0.8 + 0.5 * t,
  summer: (_t, month) => ([5, 6, 7, 8].includes(month) ? 3.2 : 0.35),
  winter: (_t, month) => ([11, 0, 1].includes(month) ? 4 : 0.15),
  springSummer: (_t, month) => (month >= 2 && month <= 7 ? 1.8 : 0.6),
  christmas: (_t, month) => (month === 11 ? 9 : 0.4),
};

// [name, category, brand, unit, price, cost ratio, walk-in quantity, weight, demand, stock, reorder level, uses, description]
// Order matters: SKUs are CH-0001 … CH-0010 in this order (the cordless drill stays CH-0010).
const PRODUCTS = [
  ["Inverter battery 200Ah (lithium)", "Solar & power", "VoltCedar", "each", 420, 0.7, 1, 1.0, "boom", 0, 6, ["power cuts", "solar systems", "backup power", "UPS"], "Lithium battery for home inverters: keeps lights, fridge and internet on through power cuts, and stores solar power."],
  ["Solar panel 450W", "Solar & power", "SunLevant", "each", 165, 0.68, 2, 1.0, "rise", 14, 10, ["rooftop solar", "power cuts", "lower generator bills"], "Monocrystalline 450W panel for rooftop systems; pairs with an inverter and battery to cut generator use."],
  ["Portable generator 3.5kW", "Solar & power", "PowerMax", "each", 690, 0.72, 1, 1.2, "decline", 38, 4, ["power cuts", "job sites", "backup power"], "Petrol generator for homes and job sites; runs a fridge, lights and small tools during power cuts."],
  ["Water pump 1HP", "Plumbing", "AquaCedar", "each", 145, 0.6, 1, 0.9, "summer", 9, 5, ["water shortages", "roof tanks", "water pressure"], "Electric pump that fills roof tanks and boosts pressure when municipal water is weak in summer."],
  ["PVC pipe 1/2 in x 4 m", "Plumbing", "AquaCedar", "each", 4.5, 0.5, 6, 1.0, "steady", 420, 120, ["leak repair", "leaking pipe", "water lines", "plumbing repairs"], "Pressure-rated PVC pipe for cold water lines; the everyday fix for a leaking or cracked pipe."],
  ["Electric space heater 2kW", "Electrical", "WarmHome", "each", 59, 0.55, 1, 0.9, "winter", 22, 8, ["winter heating", "cold rooms", "offices"], "Fan heater with two heat settings and a thermostat; warms a bedroom or small office in winter."],
  ["LED bulb 12W (pack of 4)", "Electrical", "BrightLine", "pack", 9, 0.45, 3, 1.4, "steady", 160, 40, ["lighting", "energy saving", "low power use on batteries"], "Bright 12W LED bulbs that use little power, so they run longer on an inverter battery."],
  ["Interior paint 4 L (white)", "Paint & supplies", "ColorLeb", "can", 32, 0.5, 2, 1.0, "springSummer", 64, 20, ["painting walls", "renovation", "apartments"], "Washable matt interior paint; one can covers about 40 m² in two coats."],
  ["Hand tool set (65 pieces)", "Hand tools", "IronCedar", "set", 49, 0.5, 1, 0.6, "christmas", 30, 8, ["home repairs", "gifts", "starter kit"], "Screwdrivers, sockets, pliers and a hammer in a carry case; a popular Christmas gift."],
  ["Cordless drill/driver 20V kit", "Power tools", "VoltCedar", "kit", 129, 0.62, 1, 0.8, "slowGrowth", 3, 5, ["drilling", "assembly", "shelving", "installing solar brackets"], "20V drill/driver with two batteries and a charger; drills concrete anchors, wood and metal."],
];

// Customers. Scenario customers are written out; the rest are regular shoppers and accounts.
// [name, segment, industry, branch, weight, { since: months ago they joined | "old", until: months ago they stopped, grows, likes: [product indexes] }]
const CUSTOMERS = [
  // ---- the stories ----
  ["Abi Nader Construction", "trade", "Construction", "Beirut store", 3, { since: "old", until: 6, likes: [4, 7, 9, 8] }],
  ["Byblos Bay Apartments", "commercial", "Property management", "Byblos store", 4, { since: 4, likes: [6, 7, 5, 3] }],
  ["Khoury Solar Solutions", "trade", "Solar installer", "Jounieh store", 1.2, { since: "old", grows: true, likes: [0, 1, 9] }],
  ["Haddad Plumbing", "trade", "Plumbing", "Saida store", 1.8, { since: "old", likes: [4, 3] }],
  // ---- trade and commercial accounts ----
  ["Frem Electric", "trade", "Electrical contractor", "Jounieh store", 1.2, { since: "old", likes: [6, 0, 9] }],
  ["Saab Painting", "trade", "Painting", "Beirut store", 1, { since: "old", likes: [7] }],
  ["Daou Handyman Services", "trade", "Home services", "Byblos store", 0.9, { since: 14, likes: [9, 4, 8] }],
  ["Mansour Renovations", "trade", "Construction", "Saida store", 1, { since: "old", likes: [7, 4, 9] }],
  ["Karam Carpentry", "trade", "Carpentry", "Beirut store", 0.7, { since: "old", likes: [9, 8] }],
  ["Bekaa Valley Farms", "commercial", "Agriculture", "Online", 1, { since: 11, likes: [3, 2, 0] }],
  ["Cedars Mountain Hotel", "commercial", "Hospitality", "Online", 1.1, { since: "old", likes: [5, 6, 0] }],
  ["Mar Mikhael Café Co.", "commercial", "Hospitality", "Beirut store", 0.8, { since: "old", likes: [6, 7] }],
  ["Hamra Medical Center", "commercial", "Healthcare", "Beirut store", 0.9, { since: "old", likes: [0, 2, 6] }],
  ["Saida Sea View Residences", "commercial", "Property management", "Saida store", 0.9, { since: "old", likes: [3, 6, 7] }],
  // ---- walk-in and online shoppers ----
  ["Karim Haddad", "retail", "Homeowner", "Beirut store", 1, { since: "old" }],
  ["Rania Khoury", "retail", "Homeowner", "Beirut store", 0.9, { since: "old" }],
  ["Joseph Abi Saab", "retail", "Homeowner", "Beirut store", 0.8, { since: 18 }],
  ["Lara Nassar", "retail", "Homeowner", "Beirut store", 0.8, { since: "old" }],
  ["Ziad Chamoun", "retail", "Homeowner", "Beirut store", 0.7, { since: 9 }],
  ["Maya Gemayel", "retail", "Homeowner", "Jounieh store", 1, { since: "old" }],
  ["Fadi Rahme", "retail", "Homeowner", "Jounieh store", 0.8, { since: "old" }],
  ["Christelle Aoun", "retail", "Homeowner", "Jounieh store", 0.7, { since: 12 }],
  ["Antoine Bou Khalil", "retail", "Homeowner", "Jounieh store", 0.8, { since: "old" }],
  ["Rita Tabet", "retail", "Homeowner", "Byblos store", 0.9, { since: "old" }],
  ["Elias Matar", "retail", "Homeowner", "Byblos store", 0.8, { since: "old" }],
  ["Nadine Hayek", "retail", "Homeowner", "Byblos store", 0.7, { since: 16 }],
  ["Hassan Zein", "retail", "Homeowner", "Saida store", 0.9, { since: "old" }],
  ["Mona Bizri", "retail", "Homeowner", "Saida store", 0.8, { since: "old" }],
  ["Ali Hammoud", "retail", "Homeowner", "Saida store", 0.8, { since: "old" }],
  ["Samir Kassem", "retail", "Homeowner", "Saida store", 0.6, { since: 20 }],
  ["Yara Fares", "retail", "Homeowner", "Online", 0.9, { since: 10 }],
  ["Omar Itani", "retail", "Homeowner", "Online", 1, { since: 15 }],
  ["Joelle Sfeir", "retail", "Homeowner", "Online", 0.8, { since: 7 }],
  ["Bassam Moukarzel", "retail", "Homeowner", "Online", 0.8, { since: "old" }],
  ["Dana Arslan", "retail", "Homeowner", "Online", 0.7, { since: 5 }],
  ["Walid Jaber", "retail", "Homeowner", "Online", 0.9, { since: 3 }],
];

const PLACES = {
  "Beirut store": [["Achrafieh", "Sassine Square"], ["Hamra", "Bliss Street"], ["Mar Mikhael", "Armenia Street"], ["Verdun", "Rashid Karami Street"]],
  "Jounieh store": [["Jounieh", "Fouad Chehab Avenue"], ["Kaslik", "Kaslik Main Road"], ["Zouk Mosbeh", "Zouk Highway"]],
  "Byblos store": [["Byblos", "Old Souk Road"], ["Amchit", "Amchit Main Street"]],
  "Saida store": [["Saida", "Riad El Solh Street"], ["Ghazieh", "Ghazieh Main Road"]],
  Online: [["Zahle", "Brazil Street"], ["Tripoli", "Azmi Street"], ["Batroun", "Coastal Road"], ["Aley", "Aley Main Street"]],
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

/** Store traffic by calendar month: a little busier before summer and at Christmas. */
const SEASON = [0.95, 0.9, 1.0, 1.05, 1.1, 1.1, 1.05, 1.0, 0.95, 0.95, 1.0, 1.2];
/** How much more a customer of each segment buys per line than a walk-in shopper. */
const SEGMENT_SIZE = { "Retail customer": 1, "Trade account": 4, "Commercial account": 6 };
/** Branch traffic over time: Online grows, Saida shrinks. */
const BRANCH_TREND = { Online: (t) => 0.3 + 1.6 * t, "Saida store": (t) => 1.4 - 0.9 * t };

export function generateSalesData({ seed = 42, months = 24, now = new Date() } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + rand() * (b - a);
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
        : `+961 ${pick(["1", "4", "7", "9"])} ${100 + Math.floor(rand() * 899)} ${100 + Math.floor(rand() * 899)}`,
      address: `${1 + Math.floor(rand() * 120)} ${street}, ${town}, Lebanon`,
      createdAt,
      endsAt: story.until ? monthStart(now, story.until - 1) : null, // e.g. until 6: no orders from 5 months ago onwards
    };
  });

  // Orders month by month.
  const orders = [];
  const orderItems = [];
  let number = 60000;
  for (let m = 0; m < months; m++) {
    const t = months > 1 ? m / (months - 1) : 1;
    const from = addMonths(start, m);
    const to = m === months - 1 ? now : addMonths(start, m + 1);
    const calendarMonth = from.getUTCMonth();
    const count = Math.round(52 * Math.pow(1.025, m) * SEASON[calendarMonth] * between(0.92, 1.08));
    for (let k = 0; k < count; k++) {
      const orderedAt = new Date(from.getTime() + rand() * (to.getTime() - from.getTime()));
      const active = customers.filter((c) => c.createdAt <= orderedAt && (!c.endsAt || orderedAt < c.endsAt));
      if (!active.length) continue;
      const customer = weighted(active, (c) => c.weight * (BRANCH_TREND[c.region]?.(t) ?? 1) * (c.story.grows ? 0.3 + 2.2 * t : 1));
      const rep = pick(repsByRegion[customer.region]);
      const trade = customer.segment !== SEGMENTS.retail;
      const recentDays = (now.getTime() - orderedAt.getTime()) / 864e5;
      const r = rand();
      const status = trade && recentDays < 21 && r < 0.4 ? "pending" : !trade && r < 0.025 ? "refunded" : "paid";
      const channel = customer.region === "Online" ? (r < 0.8 ? "Online" : "Phone order") : trade ? (r < 0.65 ? "Trade counter" : "Phone order") : "In store";
      const order = { id: orders.length + 1, number: `CH-${++number}`, customerId: customer.id, repId: rep.id, orderedAt, status, channel };
      orders.push(order);

      const likes = new Set(customer.story.likes ?? []);
      const lines = 1 + Math.floor(Math.pow(rand(), trade ? 1.3 : 2.4) * (trade ? 3 : 2));
      const chosen = new Set();
      for (let l = 0; l < lines; l++) {
        const product = weighted(products, (p) => p.weight * p.demand(t, calendarMonth) * (likes.has(p.id - 1) ? 5 : 1));
        if (chosen.has(product.id)) continue;
        chosen.add(product.id);
        const quantity = Math.max(1, Math.round(product.typicalQty * SEGMENT_SIZE[customer.segment] * between(0.5, 1.5)));
        const discountPct = customer.segment === SEGMENTS.commercial ? 10 : trade ? 5 : rand() < 0.08 ? 10 : 0;
        orderItems.push({ orderId: order.id, productId: product.id, quantity, unitPrice: product.unitPrice, discountPct });
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
    rep.monthlyTarget = Math.max(250, Math.round(base / 250) * 250);
  }

  // Trade quotes (the pipeline), for trade and commercial accounts only. Older quotes are closed; recent ones are open.
  const accounts = customers.filter((c) => c.segment !== SEGMENTS.retail && !c.endsAt);
  const jobs = ["rooftop solar install", "apartment fit-out", "generator replacement", "water tank and pump", "shop renovation", "building rewiring", "lobby repaint", "winter heating for offices"];
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
    const amount = Math.round(between(400, 6000) * (customer.segment === SEGMENTS.commercial ? 1.8 : 1) / 25) * 25;
    deals.push({
      id: deals.length + 1, name: `${customer.name} – ${pick(jobs)}`, customerId: customer.id, repId: rep.id, stage, amount, createdAt, closedAt,
      expectedClose: closedAt ?? new Date(createdAt.getTime() + between(7, 40) * 864e5),
    });
  };
  for (let i = 0; i < 36; i++) quote(new Date(start.getTime() + Math.pow(rand(), 0.8) * (now.getTime() - start.getTime() - 40 * 864e5)), false);
  for (let i = 0; i < 9; i++) quote(new Date(now.getTime() - between(1, 35) * 864e5), true);

  return {
    profile: { ...STORE_PROFILE },
    reps,
    customers: customers.map(({ weight, story, endsAt, ...c }) => c),
    products: products.map(({ typicalQty, weight, demand, ...p }) => p),
    orders, orderItems, deals,
  };
}
