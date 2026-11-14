// Demo sales data for the Sales dashboard. Everything here is FICTIONAL and labelled as sample data in the UI
// (AGENTS.md rule 2): invented companies, people and products, generated from a seed so it's the same every run.
// It's shaped like a real business so the charts have something honest to show: ~3% monthly growth, a Q4 peak, a
// summer dip, repeat customers, returns, and a pipeline whose old deals are closed and recent ones still open.

export const REGIONS = ["Levant", "Gulf", "Europe", "North America", "Asia Pacific"];
export const CATEGORIES = ["Branded merchandise", "Packaging", "Devices", "Apparel", "Gift sets", "Office supplies", "Print & signage"];
export const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
const SEGMENTS = ["Small business", "Mid-market", "Enterprise"];
const INDUSTRIES = ["Retail", "Hospitality", "Insurance", "Logistics", "Healthcare", "Technology", "Education", "Food & beverage", "Banking", "Real estate", "Manufacturing", "Telecom", "Events", "Non-profit", "Government", "Automotive"];
const CHANNELS = ["Direct", "Partner", "Online", "Marketplace"];

const REPS = [
  ["Lina Haddad", "Levant"], ["Omar Saleh", "Levant"], ["Rania Aziz", "Gulf"], ["Karim Nasser", "Gulf"],
  ["Sophie Martin", "Europe"], ["Lukas Weber", "Europe"], ["Emily Carter", "North America"], ["Daniel Brooks", "North America"],
  ["Nour Khalil", "Levant"], ["Elena Rossi", "Europe"], ["Hiro Tanaka", "Asia Pacific"], ["Priya Menon", "Asia Pacific"],
];

const PRODUCTS = [
  // [name, category, unit price, cost ratio, typical quantity]
  ["Canvas tote bag", "Branded merchandise", 6.5, 0.48, 300], ["Insulated bottle 750ml", "Branded merchandise", 14, 0.52, 150],
  ["Ceramic mug", "Branded merchandise", 7.5, 0.45, 200], ["Notebook A5", "Branded merchandise", 5.2, 0.5, 250],
  ["Metal pen", "Branded merchandise", 2.8, 0.42, 500], ["Lanyard", "Branded merchandise", 1.6, 0.38, 600],
  ["Umbrella", "Branded merchandise", 12, 0.55, 80], ["Desk organiser", "Branded merchandise", 18, 0.5, 60],
  ["Paper cup 12oz (case)", "Packaging", 38, 0.6, 40], ["Kraft mailer box (pack)", "Packaging", 54, 0.58, 30],
  ["Printed tape (roll)", "Packaging", 4.5, 0.55, 200], ["Tissue paper (ream)", "Packaging", 22, 0.57, 25],
  ["Gift box rigid", "Packaging", 3.9, 0.5, 300], ["Food container (case)", "Packaging", 46, 0.62, 30],
  ["Shipping label roll", "Packaging", 9, 0.5, 60], ["Barcode scanner X200", "Devices", 289, 0.66, 8],
  ["Handheld terminal T5", "Devices", 640, 0.7, 4], ["Label printer L2", "Devices", 410, 0.68, 5],
  ["Charging cradle", "Devices", 79, 0.6, 12], ["Temperature logger", "Devices", 58, 0.55, 20],
  ["Receipt printer", "Devices", 199, 0.65, 6], ["Polo shirt", "Apparel", 16, 0.47, 120],
  ["Team tee", "Apparel", 8.5, 0.44, 200], ["Hoodie", "Apparel", 29, 0.5, 70], ["Cap", "Apparel", 9.5, 0.45, 150],
  ["Apron", "Apparel", 13, 0.46, 60], ["Fleece jacket", "Apparel", 42, 0.55, 40], ["Welcome kit", "Gift sets", 48, 0.55, 60],
  ["Client thank-you box", "Gift sets", 65, 0.56, 40], ["Event giveaway pack", "Gift sets", 19, 0.5, 150],
  ["Holiday hamper", "Gift sets", 89, 0.6, 25], ["Wellness set", "Gift sets", 37, 0.52, 50],
  ["Desk starter set", "Gift sets", 55, 0.54, 35], ["Tech accessory kit", "Gift sets", 72, 0.6, 30],
  ["Coffee gift tin", "Gift sets", 24, 0.5, 80], ["Notebook & pen set", "Gift sets", 15, 0.48, 120],
  ["Wireless charger pad", "Branded merchandise", 19, 0.56, 90], ["Bamboo cutlery set", "Branded merchandise", 6.9, 0.46, 220],
  ["Power bank 10k", "Branded merchandise", 24, 0.6, 70], ["Sticky notes (pack)", "Office supplies", 3.2, 0.4, 400],
  ["Recycled copy paper (box)", "Office supplies", 31, 0.66, 30], ["Whiteboard markers (set)", "Office supplies", 7.8, 0.45, 120],
  ["Desk calendar 2027", "Office supplies", 9.5, 0.44, 150], ["Filing boxes (pack)", "Office supplies", 18, 0.52, 60],
  ["Ergonomic mouse", "Office supplies", 34, 0.58, 40], ["Roll-up banner", "Print & signage", 95, 0.52, 6],
  ["Poster A2 (pack of 50)", "Print & signage", 68, 0.48, 10], ["Business cards (500)", "Print & signage", 39, 0.35, 25],
  ["Window decals (set)", "Print & signage", 54, 0.42, 12], ["Trade-show backdrop", "Print & signage", 780, 0.6, 2],
  ["Flyers A5 (1,000)", "Print & signage", 85, 0.4, 8], ["Corrugated shipper (pack)", "Packaging", 61, 0.6, 25],
  ["Compostable bag (case)", "Packaging", 44, 0.58, 30], ["Smart shelf label kit", "Devices", 1250, 0.72, 2],
  ["RFID reader", "Devices", 520, 0.69, 4], ["Rain jacket", "Apparel", 58, 0.56, 30], ["Beanie", "Apparel", 11, 0.44, 120],
  ["Spa gift box", "Gift sets", 79, 0.58, 30], ["Gourmet snack crate", "Gift sets", 46, 0.55, 45], ["Plant & pot set", "Gift sets", 33, 0.5, 60],
];

const NAME_A = ["Sable", "Beacon", "Crestview", "Driftwood", "Emberly", "Foxglove", "Goldleaf", "Hawthorne", "Ivory", "Jadestone", "Keystone", "Lighthouse", "Moonrise", "Nimbus", "Oakridge", "Cedar", "Harbor", "Atlas", "Orion", "Maple", "Brightwater", "Northwind", "Lumen", "Castellan", "Ridgeway", "Silverline", "Bluefin", "Larkspur", "Corvid", "Juniper", "Meridian", "Aurora", "Pinecrest", "Summit", "Tidewater", "Copperfield", "Evergreen", "Highland", "Riverstone", "Saffron", "Willow", "Granite", "Halcyon", "Ironbridge", "Kestrel"];
const NAME_B = ["Bank", "Realty", "Motors", "Events", "Telecom", "Foundation", "Works", "Collective", "Retail", "Foods", "Hospitality", "Insurance", "Logistics", "Labs", "Health", "Fitness", "Group", "Partners", "Stores", "Hotels", "Supply", "Studios", "Clinics", "Academy", "Trading", "Markets"];

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
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Seasonality by calendar month (0 = Jan): quiet summer, busy Q4. */
const SEASON = [0.9, 0.88, 1.0, 1.02, 1.05, 0.92, 0.82, 0.8, 1.04, 1.12, 1.28, 1.38];

export function generateSalesData({ seed = 42, months = 24, now = new Date() } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + rand() * (b - a);
  const start = addMonths(now, -months);
  const span = now.getTime() - start.getTime();
  const at = (fraction) => new Date(start.getTime() + Math.min(0.999999, Math.max(0, fraction)) * span);

  const reps = REPS.map(([name, region], i) => ({ id: i + 1, name, region, monthlyTarget: Math.round(between(115000, 190000) / 5000) * 5000 }));

  const products = PRODUCTS.map(([name, category, price, costRatio, qty], i) => ({
    id: i + 1, sku: `NW-${String(i + 1).padStart(3, "0")}`, name, category, unitPrice: price, unitCost: round2(price * costRatio), typicalQty: qty,
  }));

  // Customers: a base that existed before the window, then a steady trickle of new ones (more of them later on).
  const used = new Set();
  const customers = [];
  for (let i = 0; i < 480; i++) {
    let name;
    do name = `${pick(NAME_A)} ${pick(NAME_B)}`; while (used.has(name));
    used.add(name);
    const region = REGIONS[Math.floor(Math.pow(rand(), 1.3) * REGIONS.length)];
    const existing = i < 170;
    customers.push({
      id: i + 1, name, region, industry: pick(INDUSTRIES),
      segment: SEGMENTS[rand() < 0.55 ? 0 : rand() < 0.75 ? 1 : 2],
      email: `orders@${slug(name)}.example`,
      createdAt: existing ? new Date(start.getTime() - between(30, 900) * 864e5) : at(Math.pow(rand(), 0.8)),
    });
  }
  const repsByRegion = Object.fromEntries(REGIONS.map((r) => [r, reps.filter((x) => x.region === r)]));
  const segmentSize = { "Small business": 1, "Mid-market": 2.4, Enterprise: 5.5 };

  // Orders month by month: growth * seasonality, spread over the days of the month.
  const orders = [];
  const orderItems = [];
  let number = 10000;
  for (let m = 0; m < months; m++) {
    const monthStart = addMonths(start, m);
    const monthEnd = m === months - 1 ? now : addMonths(start, m + 1);
    const count = Math.round(230 * Math.pow(1.03, m) * SEASON[monthStart.getUTCMonth()] * between(0.92, 1.08));
    for (let k = 0; k < count; k++) {
      const orderedAt = new Date(monthStart.getTime() + rand() * (monthEnd.getTime() - monthStart.getTime()));
      const active = customers.filter((c) => c.createdAt <= orderedAt);
      // Bigger, older customers order more often.
      const customer = active[Math.floor(Math.pow(rand(), 1.6) * active.length)] ?? active[0];
      const rep = pick(repsByRegion[customer.region]);
      const recent = now.getTime() - orderedAt.getTime() < 14 * 864e5;
      const r = rand();
      const status = recent && r < 0.35 ? "pending" : r < 0.03 ? "refunded" : "paid";
      const order = { id: orders.length + 1, number: `SO-${++number}`, customerId: customer.id, repId: rep.id, orderedAt, status, channel: CHANNELS[r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.92 ? 2 : 3] };
      orders.push(order);
      const lines = 1 + Math.floor(Math.pow(rand(), 1.8) * 4);
      const chosen = new Set();
      for (let l = 0; l < lines; l++) {
        const product = pick(products);
        if (chosen.has(product.id)) continue;
        chosen.add(product.id);
        const quantity = Math.max(1, Math.round(product.typicalQty * segmentSize[customer.segment] * between(0.3, 1.4)));
        const discountPct = quantity > product.typicalQty * 2 ? 10 : rand() < 0.25 ? 5 : 0;
        orderItems.push({ orderId: order.id, productId: product.id, quantity, unitPrice: product.unitPrice, discountPct });
      }
    }
  }

  // Deals: created across the window; the older a deal, the likelier it has closed.
  const deals = [];
  const dealCount = 900;
  for (let i = 0; i < dealCount; i++) {
    const createdAt = at(Math.pow(rand(), 0.85));
    const customer = pick(customers);
    const rep = pick(repsByRegion[customer.region]);
    const ageDays = (now.getTime() - createdAt.getTime()) / 864e5;
    const closedChance = Math.min(0.96, ageDays / 160);
    let stage, closedAt = null;
    if (rand() < closedChance) {
      stage = rand() < 0.38 ? "won" : "lost";
      closedAt = new Date(Math.min(now.getTime(), createdAt.getTime() + between(10, Math.max(12, Math.min(ageDays, 110))) * 864e5));
    } else {
      stage = STAGES[Math.floor(Math.pow(rand(), 1.4) * 4)];
    }
    const amount = Math.round(between(2500, 18000) * segmentSize[customer.segment] / 50) * 50;
    deals.push({
      id: i + 1, name: `${customer.name.split(" ")[0]} ${pick(["welcome kits", "event giveaways", "packaging refresh", "scanner rollout", "uniforms", "holiday gifts", "annual supply", "pilot order"])}`,
      customerId: customer.id, repId: rep.id, stage, amount, createdAt, closedAt,
      expectedClose: closedAt ?? new Date(createdAt.getTime() + between(20, 90) * 864e5),
    });
  }

  return { reps, customers, products: products.map(({ typicalQty, ...p }) => p), orders, orderItems, deals };
}
