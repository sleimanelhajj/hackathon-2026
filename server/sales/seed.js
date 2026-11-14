// Demo sales data for the Sales dashboard and the assistant. Everything here is FICTIONAL and labelled as sample data
// in the UI (AGENTS.md rule 2): an invented hardware & convenience store, its branches, staff, customers and products,
// generated from a seed so it's the same every run. It's shaped like a real store so the charts and the assistant have
// something honest to work with: ~3% monthly growth, a spring/summer DIY peak, mostly small walk-in baskets plus big
// trade orders, low-stock items, and a pipeline of trade quotes whose old ones are closed and recent ones still open.

export const REGIONS = ["Downtown store", "Harbor store", "Westfield store", "Northgate store", "Online"];
export const CATEGORIES = [
  "Hand tools", "Power tools", "Fasteners", "Plumbing", "Electrical", "Paint & supplies",
  "Garden & outdoor", "Safety gear", "Cleaning & janitorial", "Storage & home",
];
export const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
const SEGMENTS = ["Retail customer", "Trade account", "Commercial account"];
const CHANNELS = ["In store", "Trade counter", "Online", "Phone order"];

/** The store issuing invoices. Fictional; .example domain. */
export const STORE_PROFILE = {
  name: "Cornerstone Hardware & Supply",
  email: "billing@cornerstonehardware.example",
  phone: "(555) 014-2290",
  address: "418 Market Street, Maple Falls, CA 95401",
  currency: "USD",
  taxRateBps: 825, // 8.25% sales tax
  paymentTermsDays: 30,
};

const REPS = [
  ["Maya Ortiz", "Downtown store"], ["Sam Whitaker", "Downtown store"], ["Jonah Reyes", "Downtown store"],
  ["Priya Shah", "Harbor store"], ["Leo Martins", "Harbor store"], ["Ava Thompson", "Westfield store"],
  ["Noah Kim", "Westfield store"], ["Grace Liu", "Northgate store"], ["Ethan Brooks", "Northgate store"],
  ["Hannah Cole", "Northgate store"], ["Owen Patel", "Online"], ["Zoe Bennett", "Online"],
];

// [name, category, brand, unit, price, cost ratio, typical walk-in quantity, uses, description]
const PRODUCTS = [
  ["16 oz claw hammer", "Hand tools", "IronLeaf", "each", 18.99, 0.48, 1, ["framing", "nails", "general repairs", "demolition"], "Fibreglass handle with a rubber grip and a curved claw for pulling nails; the everyday hammer for framing and repairs."],
  ["25 ft tape measure", "Hand tools", "ProGrip", "each", 14.49, 0.45, 1, ["measuring", "carpentry", "renovation"], "Locking 25 ft steel blade with a magnetic hook; reads inches and metric."],
  ["Screwdriver set (10 pc)", "Hand tools", "ProGrip", "set", 24.99, 0.46, 1, ["assembly", "electrical", "furniture", "general repairs"], "Phillips, flat and Torx tips with cushioned handles; covers most household and furniture screws."],
  ["Adjustable wrench 10 in", "Hand tools", "IronLeaf", "each", 16.99, 0.47, 1, ["plumbing", "bolts", "bike repair"], "Chrome-vanadium wrench that opens to 1-1/4 in; good for nuts, bolts and pipe fittings."],
  ["Utility knife with 10 blades", "Hand tools", "ProGrip", "each", 9.99, 0.4, 1, ["cutting", "drywall", "carpet", "packaging"], "Retractable utility knife with quick blade change and ten spare blades."],
  ["Torpedo level 9 in", "Hand tools", "BuildRight", "each", 11.49, 0.45, 1, ["shelving", "picture hanging", "tiling"], "Magnetic level with three vials for level, plumb and 45 degree checks."],
  ["Hacksaw 12 in", "Hand tools", "IronLeaf", "each", 15.99, 0.46, 1, ["cutting pipe", "cutting metal", "plumbing"], "High-tension frame for cutting metal pipe, bolts and plastic conduit."],
  ["Locking pliers set (3 pc)", "Hand tools", "IronLeaf", "set", 27.99, 0.48, 1, ["gripping", "plumbing", "automotive", "stuck bolts"], "Curved-jaw locking pliers in three sizes for clamping and stripped bolts."],
  ["Mechanic tool kit (120 pc)", "Hand tools", "ProGrip", "kit", 89.99, 0.55, 1, ["automotive", "home maintenance", "starter kit"], "Sockets, ratchets, wrenches and bits in a hard case; a complete starter kit for a new home owner."],
  ["Cordless drill/driver 20V kit", "Power tools", "VoltEdge", "kit", 129.0, 0.62, 1, ["drilling", "driving screws", "assembly", "shelving"], "Two-speed 20V drill/driver with two batteries, charger and bag; drills wood, metal and drywall."],
  ["Hammer drill 20V (tool only)", "Power tools", "VoltEdge", "each", 149.0, 0.63, 1, ["masonry", "concrete anchors", "brick"], "Hammer mode for drilling into brick and concrete; uses VoltEdge 20V batteries."],
  ["Impact driver 20V kit", "Power tools", "VoltEdge", "kit", 159.0, 0.63, 1, ["deck building", "lag screws", "framing"], "High-torque impact driver for long screws and lag bolts; two batteries included."],
  ["Circular saw 7-1/4 in", "Power tools", "VoltEdge", "each", 119.0, 0.6, 1, ["cutting lumber", "plywood", "framing", "deck building"], "15-amp corded circular saw with laser guide and bevel up to 56 degrees."],
  ["Jigsaw variable speed", "Power tools", "VoltEdge", "each", 79.0, 0.58, 1, ["curved cuts", "countertops", "crafts"], "Orbital jigsaw for curves in wood, laminate and thin metal."],
  ["Random orbit sander 5 in", "Power tools", "VoltEdge", "each", 69.0, 0.57, 1, ["sanding", "furniture refinishing", "paint prep"], "Variable-speed sander with dust bag; smooth finish for refinishing and paint prep."],
  ["20V battery 4.0Ah", "Power tools", "VoltEdge", "each", 79.0, 0.6, 1, ["spare battery", "cordless tools"], "Spare lithium battery that fits every VoltEdge 20V tool."],
  ["Drill bit set (29 pc)", "Power tools", "VoltEdge", "set", 32.99, 0.5, 1, ["drilling", "metal", "wood"], "Titanium-coated HSS bits from 1/16 to 1/2 in for wood, plastic and metal."],
  ["Wood screws #8 x 1-1/4 (100)", "Fasteners", "BuildRight", "box of 100", 7.49, 0.38, 2, ["woodwork", "cabinets", "shelving"], "Zinc-plated coarse-thread wood screws with Phillips drive."],
  ["Deck screws 3 in (1 lb)", "Fasteners", "BuildRight", "1 lb box", 12.99, 0.4, 2, ["deck building", "fences", "outdoor wood"], "Coated, corrosion-resistant star-drive screws rated for pressure-treated lumber."],
  ["Drywall screws 1-5/8 (1 lb)", "Fasteners", "BuildRight", "1 lb box", 8.99, 0.38, 2, ["drywall", "renovation"], "Fine-thread bugle-head screws for hanging drywall on wood studs."],
  ["Wall anchors kit (100)", "Fasteners", "BuildRight", "kit", 9.99, 0.36, 1, ["picture hanging", "shelving", "TV mounting", "drywall"], "Plastic and self-drilling anchors with screws for hanging on drywall."],
  ["Concrete anchors 1/4 in (25)", "Fasteners", "BuildRight", "box of 25", 13.49, 0.42, 1, ["masonry", "brick", "concrete"], "Blue masonry screws that hold in concrete, brick and block."],
  ["Common nails 3 in (5 lb)", "Fasteners", "BuildRight", "5 lb box", 16.99, 0.42, 1, ["framing", "carpentry"], "Bright common nails for general framing and rough carpentry."],
  ["Hex bolts & nuts assortment", "Fasteners", "BuildRight", "kit", 19.99, 0.4, 1, ["repairs", "furniture", "machinery"], "Grade 5 zinc bolts, nuts and washers in a sorted case."],
  ["PVC pipe 1/2 in x 10 ft", "Plumbing", "AquaFlow", "each", 6.49, 0.5, 3, ["irrigation", "plumbing repairs", "DIY projects"], "Schedule 40 PVC pressure pipe for cold water and irrigation lines."],
  ["PEX tubing 1/2 in x 100 ft", "Plumbing", "AquaFlow", "roll", 39.99, 0.55, 1, ["water lines", "bathroom remodel", "kitchen remodel"], "Flexible red PEX-B tubing for hot water supply lines."],
  ["Push-fit coupling 1/2 in", "Plumbing", "AquaFlow", "each", 8.99, 0.45, 2, ["leak repair", "pipe joining", "emergency repair"], "Tool-free push-to-connect coupling for copper, PEX and CPVC; fixes a burst pipe in minutes."],
  ["Plumber's tape (3 rolls)", "Plumbing", "AquaFlow", "pack", 3.99, 0.3, 2, ["leaky threads", "shower heads", "fittings"], "PTFE thread seal tape for sealing threaded pipe joints."],
  ["Kitchen faucet pull-down", "Plumbing", "AquaFlow", "each", 149.0, 0.58, 1, ["kitchen remodel", "faucet replacement"], "Single-handle pull-down faucet in brushed nickel with a two-function spray."],
  ["Toilet repair kit", "Plumbing", "AquaFlow", "kit", 24.99, 0.44, 1, ["running toilet", "toilet repair", "water saving"], "Fill valve, flapper and flush valve seal; fixes a running or leaking toilet."],
  ["Drain auger 25 ft", "Plumbing", "AquaFlow", "each", 34.99, 0.5, 1, ["clogged drain", "sink clog", "shower drain"], "Hand-crank drum auger that clears clogs in sinks, tubs and showers."],
  ["Silicone sealant clear", "Plumbing", "AquaFlow", "tube", 7.99, 0.38, 2, ["bathroom", "sealing", "windows", "kitchen"], "Mould-resistant 100% silicone for tubs, sinks and windows."],
  ["Extension cord 50 ft outdoor", "Electrical", "BrightLine", "each", 39.99, 0.5, 1, ["outdoor power", "power tools", "holiday lights"], "12-gauge weather-resistant cord with lighted ends, rated 15 amps."],
  ["Surge protector 8-outlet", "Electrical", "BrightLine", "each", 26.99, 0.45, 1, ["electronics", "home office", "TV"], "2,400-joule surge protector with two USB ports."],
  ["LED bulbs A19 60W (8 pack)", "Electrical", "BrightLine", "pack", 15.99, 0.42, 2, ["lighting", "energy saving"], "Soft white 800-lumen LED bulbs that use 9 watts each."],
  ["Smart plug Wi-Fi (2 pack)", "Electrical", "BrightLine", "pack", 22.99, 0.5, 1, ["smart home", "lamps", "timers"], "App and voice-controlled plugs with schedules; no hub needed."],
  ["Outlet tester", "Electrical", "BrightLine", "each", 12.99, 0.4, 1, ["electrical safety", "home inspection"], "Plug-in tester that shows wiring faults and checks GFCI outlets."],
  ["Electrical wire 12/2 x 50 ft", "Electrical", "BrightLine", "roll", 64.99, 0.62, 1, ["new circuits", "renovation", "electrician"], "NM-B copper building wire with ground for 20-amp circuits."],
  ["LED shop light 4 ft", "Electrical", "BrightLine", "each", 34.99, 0.52, 1, ["garage lighting", "workshop", "basement"], "Linkable 4,000-lumen LED fixture; hangs or mounts flush."],
  ["Interior paint eggshell 1 gal", "Paint & supplies", "BrightCoat", "gallon", 38.99, 0.5, 2, ["painting walls", "bedroom", "living room"], "Washable one-coat interior paint and primer in an eggshell finish; tinted in store."],
  ["Exterior paint satin 1 gal", "Paint & supplies", "BrightCoat", "gallon", 46.99, 0.52, 2, ["exterior walls", "siding", "fences"], "Weather and mildew-resistant exterior acrylic that resists peeling."],
  ["Primer multi-surface 1 gal", "Paint & supplies", "BrightCoat", "gallon", 27.99, 0.48, 1, ["stain blocking", "new drywall", "paint prep"], "Water-based primer that seals new drywall and blocks stains."],
  ["Roller kit 9 in (5 pc)", "Paint & supplies", "BrightCoat", "kit", 16.99, 0.4, 1, ["painting walls", "ceilings"], "Roller frame, two covers, tray and liner for walls and ceilings."],
  ["Paint brush set (3 pc)", "Paint & supplies", "BrightCoat", "set", 14.99, 0.42, 1, ["trim", "cutting in", "small projects"], "Angled and flat synthetic brushes for trim and cutting in."],
  ["Painter's tape 1.88 in (3 rolls)", "Paint & supplies", "BrightCoat", "pack", 17.99, 0.45, 1, ["clean lines", "trim", "masking"], "Blue tape that leaves sharp lines and peels off cleanly for 14 days."],
  ["Drop cloth canvas 9x12", "Paint & supplies", "BrightCoat", "each", 21.99, 0.46, 1, ["floor protection", "furniture covering"], "Heavy canvas drop cloth that absorbs drips and won't slip."],
  ["Wood stain & sealer 1 gal", "Paint & supplies", "BrightCoat", "gallon", 42.99, 0.52, 1, ["deck building", "fences", "outdoor furniture"], "Semi-transparent oil-based stain and sealer that protects decks from sun and rain."],
  ["Garden hose 50 ft", "Garden & outdoor", "GreenYard", "each", 29.99, 0.48, 1, ["watering", "car washing", "garden"], "Kink-resistant reinforced hose with brass fittings."],
  ["Hose nozzle 8-pattern", "Garden & outdoor", "GreenYard", "each", 9.99, 0.38, 1, ["watering", "car washing"], "Metal spray nozzle with eight patterns and a thumb control."],
  ["Potting mix 1 cu ft", "Garden & outdoor", "GreenYard", "bag", 11.99, 0.45, 3, ["container plants", "garden beds", "herbs"], "Lightweight potting mix with fertiliser that feeds for up to six months."],
  ["Grass seed sun & shade 3 lb", "Garden & outdoor", "GreenYard", "bag", 24.99, 0.5, 1, ["lawn repair", "bare spots", "new lawn"], "Seed mix that grows in full sun and partial shade."],
  ["Pruning shears bypass", "Garden & outdoor", "GreenYard", "each", 19.99, 0.42, 1, ["pruning", "roses", "shrubs"], "Sharp bypass blades for clean cuts on live stems up to 3/4 in."],
  ["Leaf rake 24 in", "Garden & outdoor", "GreenYard", "each", 21.99, 0.45, 1, ["fall cleanup", "leaves", "yard work"], "Wide steel-tine rake with a cushioned handle."],
  ["Wheelbarrow 6 cu ft", "Garden & outdoor", "GreenYard", "each", 119.0, 0.6, 1, ["landscaping", "moving soil", "concrete mixing"], "Steel tray wheelbarrow with a flat-free tyre."],
  ["Ice melt 25 lb", "Garden & outdoor", "GreenYard", "bag", 18.99, 0.48, 2, ["winter", "icy steps", "driveways"], "Pet-friendly ice melt that works down to -15 F."],
  ["Work gloves leather (3 pairs)", "Safety gear", "SafeGuard", "pack", 19.99, 0.42, 1, ["yard work", "construction", "moving"], "Split-leather gloves with a reinforced palm."],
  ["Safety glasses clear (4 pack)", "Safety gear", "SafeGuard", "pack", 14.99, 0.38, 1, ["power tools", "eye protection", "construction"], "ANSI Z87.1 impact-rated glasses with anti-fog lenses."],
  ["N95 respirator masks (10)", "Safety gear", "SafeGuard", "box of 10", 19.99, 0.45, 1, ["sanding", "dust", "insulation work"], "NIOSH-approved disposable respirators for dust and sanding."],
  ["Ear muffs NRR 25", "Safety gear", "SafeGuard", "each", 17.99, 0.44, 1, ["hearing protection", "power tools", "mowing"], "Padded folding ear muffs with 25 dB noise reduction."],
  ["Hard hat type 1", "Safety gear", "SafeGuard", "each", 22.99, 0.46, 1, ["job site", "construction"], "Vented hard hat with a ratchet suspension."],
  ["Fire extinguisher ABC 5 lb", "Safety gear", "SafeGuard", "each", 54.99, 0.58, 1, ["fire safety", "kitchen", "garage", "workshop"], "Rechargeable extinguisher for ordinary, liquid and electrical fires."],
  ["Smoke & CO alarm combo", "Safety gear", "SafeGuard", "each", 39.99, 0.55, 1, ["home safety", "new home", "rental units"], "Battery-powered combination alarm with a 10-year sealed battery."],
  ["Heavy-duty trash bags 42 gal (32)", "Cleaning & janitorial", "CleanCrew", "box of 32", 21.99, 0.48, 1, ["job site cleanup", "yard waste", "garage"], "3-mil contractor bags that resist punctures from debris."],
  ["Shop vacuum 6 gal wet/dry", "Cleaning & janitorial", "CleanCrew", "each", 79.0, 0.58, 1, ["garage cleanup", "water spills", "renovation dust"], "Wet/dry vacuum with blower port and a washable filter."],
  ["Degreaser concentrate 1 gal", "Cleaning & janitorial", "CleanCrew", "gallon", 16.99, 0.4, 1, ["garage floors", "engines", "kitchens"], "Biodegradable heavy-duty degreaser that dilutes up to 1:20."],
  ["Microfibre cloths (24)", "Cleaning & janitorial", "CleanCrew", "pack", 15.99, 0.38, 1, ["cleaning", "car detailing", "dusting"], "Lint-free cloths that clean with water only."],
  ["Steel shelving unit 5-tier", "Storage & home", "TidyBox", "each", 89.0, 0.6, 1, ["garage organisation", "storage", "basement"], "Boltless steel shelving, 72 in tall, holds 350 lb per shelf."],
  ["Storage tote 27 gal (4 pack)", "Storage & home", "TidyBox", "pack", 44.99, 0.55, 1, ["moving", "garage organisation", "seasonal storage"], "Stackable tough totes with snap lids."],
  ["Tool chest 26 in", "Storage & home", "TidyBox", "each", 139.0, 0.62, 1, ["tool storage", "workshop", "garage"], "Five-drawer chest with ball-bearing slides and a lock."],
  ["Wall hooks & rails garage kit", "Storage & home", "TidyBox", "kit", 49.99, 0.5, 1, ["garage organisation", "bikes", "ladders"], "Steel rails with eight hooks for bikes, ladders and tools."],
  ["Step ladder 6 ft fibreglass", "Storage & home", "TidyBox", "each", 99.0, 0.6, 1, ["painting", "ceiling work", "electrical work"], "Non-conductive fibreglass ladder rated to 250 lb; safe near wiring."],
];

const FIRST = ["James", "Maria", "David", "Sofia", "Michael", "Aisha", "Daniel", "Elena", "Chris", "Fatima", "Robert", "Linda", "Kevin", "Nadia", "Brian", "Julia", "Marcus", "Hana", "Tyler", "Rosa", "Andre", "Claire", "Victor", "Mei", "Patrick", "Leila", "Gabriel", "Irene", "Samuel", "Tessa"];
const LAST = ["Garcia", "Nguyen", "Miller", "Haddad", "Johnson", "Okafor", "Rossi", "Kowalski", "Brown", "Silva", "Murphy", "Chen", "Walsh", "Novak", "Diaz", "Fischer", "Hughes", "Park", "Sanders", "Moreau", "Ward", "Bishop", "Romero", "Petrov"];
const TRADE_A = ["Cedar Ridge", "Summit", "Ironwood", "Bluewater", "Keystone", "Pioneer", "Redline", "Oak Valley", "Granite", "Northstar", "Clearview", "Hilltop", "Riverbend", "True Level", "Copper Creek", "Silver Pine", "Maple Falls", "Brightway", "Heritage", "Lakeside"];
const TRADES = [
  ["Builders", "Construction"], ["Construction", "Construction"], ["Plumbing", "Plumbing"], ["Electric", "Electrical contractor"],
  ["Painting", "Painting"], ["Landscaping", "Landscaping"], ["Roofing", "Roofing"], ["Renovations", "Construction"],
  ["Carpentry", "Carpentry"], ["Handyman Services", "Home services"], ["HVAC", "HVAC"],
];
const COMMERCIAL = [
  ["Property Management", "Property management"], ["Apartments", "Property management"], ["Hotel", "Hospitality"],
  ["Café", "Hospitality"], ["School District", "Education"], ["Facilities Services", "Facilities"], ["Medical Center", "Healthcare"],
];
const STREETS = ["Oak", "Pine", "Elm", "Market", "Harbor", "Mill", "River", "Lake", "Ridge", "Station", "Orchard", "Union", "Spruce", "Willow", "Center"];
const STREET_TYPES = ["Street", "Avenue", "Road", "Lane", "Drive", "Court"];
const TOWNS = ["Maple Falls", "Harbor Point", "Westfield", "Northgate", "Cedar Grove"];

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

/** Seasonality by calendar month (0 = Jan): DIY peaks in spring and early summer, a December gift bump. */
const SEASON = [0.82, 0.86, 1.02, 1.16, 1.24, 1.2, 1.08, 1.0, 0.98, 0.94, 0.9, 1.04];
/** How much more a customer of each segment buys per line than a walk-in shopper. */
const SEGMENT_SIZE = { "Retail customer": 1, "Trade account": 4, "Commercial account": 9 };

export function generateSalesData({ seed = 42, months = 24, now = new Date() } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + rand() * (b - a);
  const start = addMonths(now, -months);
  const span = now.getTime() - start.getTime();
  const at = (fraction) => new Date(start.getTime() + Math.min(0.999999, Math.max(0, fraction)) * span);

  const reps = REPS.map(([name, region], i) => ({ id: i + 1, name, region, monthlyTarget: 0 }));

  const products = PRODUCTS.map(([name, category, brand, unit, price, costRatio, qty, uses, description], i) => {
    const reorderLevel = Math.max(4, Math.round(qty * 6));
    const stock = rand() < 0.14 ? Math.floor(reorderLevel * between(0, 0.95)) : Math.round(reorderLevel * between(2, 9));
    return {
      id: i + 1, sku: `CH-${String(i + 1).padStart(4, "0")}`, name, category, brand, unit, description, uses,
      unitPrice: price, unitCost: round2(price * costRatio), stock, reorderLevel, typicalQty: qty,
    };
  });

  // Customers: walk-in shoppers who gave details for a receipt, trade accounts, and commercial accounts.
  const used = new Set();
  const customers = [];
  for (let i = 0; i < 480; i++) {
    const r = rand();
    const segment = r < 0.55 ? SEGMENTS[0] : r < 0.88 ? SEGMENTS[1] : SEGMENTS[2];
    let name, industry;
    do {
      if (segment === SEGMENTS[0]) { name = `${pick(FIRST)} ${pick(LAST)}`; industry = "Homeowner"; }
      else { const [suffix, ind] = pick(segment === SEGMENTS[1] ? TRADES : COMMERCIAL); name = `${pick(TRADE_A)} ${suffix}`; industry = ind; }
    } while (used.has(name));
    used.add(name);
    const region = REGIONS[Math.floor(Math.pow(rand(), 1.15) * REGIONS.length)];
    const existing = i < 170;
    const town = pick(TOWNS);
    customers.push({
      id: i + 1, name, region, industry, segment,
      email: segment === SEGMENTS[0] ? `${slug(name)}@mail.example` : `accounts@${slug(name)}.example`,
      phone: `(555) 0${String(10 + Math.floor(rand() * 89))}-${String(1000 + Math.floor(rand() * 8999))}`,
      address: `${10 + Math.floor(rand() * 980)} ${pick(STREETS)} ${pick(STREET_TYPES)}, ${town}, CA 954${String(Math.floor(rand() * 90) + 10)}`,
      createdAt: existing ? new Date(start.getTime() - between(30, 900) * 864e5) : at(Math.pow(rand(), 0.8)),
    });
  }
  const repsByRegion = Object.fromEntries(REGIONS.map((r) => [r, reps.filter((x) => x.region === r)]));

  // Orders month by month: growth * seasonality, spread over the days of the month.
  const orders = [];
  const orderItems = [];
  let number = 50000;
  for (let m = 0; m < months; m++) {
    const monthStart = addMonths(start, m);
    const monthEnd = m === months - 1 ? now : addMonths(start, m + 1);
    const count = Math.round(360 * Math.pow(1.03, m) * SEASON[monthStart.getUTCMonth()] * between(0.92, 1.08));
    for (let k = 0; k < count; k++) {
      const orderedAt = new Date(monthStart.getTime() + rand() * (monthEnd.getTime() - monthStart.getTime()));
      const active = customers.filter((c) => c.createdAt <= orderedAt);
      // Regulars (older customers) come back more often.
      const customer = active[Math.floor(Math.pow(rand(), 1.6) * active.length)] ?? active[0];
      const rep = pick(repsByRegion[customer.region]);
      const recent = now.getTime() - orderedAt.getTime() < 14 * 864e5;
      const r = rand();
      const trade = customer.segment !== SEGMENTS[0];
      const status = trade && recent && r < 0.4 ? "pending" : r < 0.025 ? "refunded" : "paid";
      const channel = customer.region === "Online" ? (r < 0.8 ? "Online" : "Phone order") : trade ? (r < 0.65 ? "Trade counter" : "Phone order") : "In store";
      const order = { id: orders.length + 1, number: `CH-${++number}`, customerId: customer.id, repId: rep.id, orderedAt, status, channel };
      orders.push(order);
      const lines = 1 + Math.floor(Math.pow(rand(), trade ? 1.2 : 2.2) * (trade ? 6 : 4));
      const chosen = new Set();
      for (let l = 0; l < lines; l++) {
        const product = pick(products);
        if (chosen.has(product.id)) continue;
        chosen.add(product.id);
        const quantity = Math.max(1, Math.round(product.typicalQty * SEGMENT_SIZE[customer.segment] * between(0.4, 1.6)));
        const discountPct = customer.segment === SEGMENTS[2] ? 10 : trade ? 5 : rand() < 0.08 ? 10 : 0;
        orderItems.push({ orderId: order.id, productId: product.id, quantity, unitPrice: product.unitPrice, discountPct });
      }
    }
  }

  // Staff targets: what each person sold over the last six months, plus a stretch (rounded to $500).
  const orderValue = new Map();
  for (const it of orderItems) orderValue.set(it.orderId, (orderValue.get(it.orderId) ?? 0) + it.quantity * it.unitPrice * (1 - it.discountPct / 100));
  const cut = addMonths(now, -6);
  const recentByRep = new Map();
  for (const o of orders) if (o.orderedAt >= cut && o.status !== "refunded") recentByRep.set(o.repId, (recentByRep.get(o.repId) ?? 0) + orderValue.get(o.id));
  for (const rep of reps) rep.monthlyTarget = Math.max(500, Math.round(((recentByRep.get(rep.id) ?? 0) / 6) * between(0.92, 1.12) / 500) * 500);

  // Trade quotes (the pipeline): created across the window; the older a quote, the likelier it has closed.
  const tradeCustomers = customers.filter((c) => c.segment !== SEGMENTS[0]);
  const jobs = ["kitchen remodel supplies", "deck build materials", "bathroom refit", "rental unit turnover", "fence replacement", "warehouse shelving", "office repaint", "irrigation install", "lighting retrofit", "job site restock", "roof repair materials", "annual maintenance supplies"];
  const deals = [];
  for (let i = 0; i < 900; i++) {
    const createdAt = at(Math.pow(rand(), 0.85));
    const customer = pick(tradeCustomers);
    const rep = pick(repsByRegion[customer.region]);
    const ageDays = (now.getTime() - createdAt.getTime()) / 864e5;
    const closedChance = Math.min(0.96, ageDays / 90);
    let stage, closedAt = null;
    if (rand() < closedChance) {
      stage = rand() < 0.45 ? "won" : "lost";
      closedAt = new Date(Math.min(now.getTime(), createdAt.getTime() + between(3, Math.max(5, Math.min(ageDays, 45))) * 864e5));
    } else {
      stage = STAGES[Math.floor(Math.pow(rand(), 1.4) * 4)];
    }
    const amount = Math.round(between(400, 6500) * (customer.segment === SEGMENTS[2] ? 2.2 : 1) / 25) * 25;
    deals.push({
      id: i + 1, name: `${customer.name} – ${pick(jobs)}`,
      customerId: customer.id, repId: rep.id, stage, amount, createdAt, closedAt,
      expectedClose: closedAt ?? new Date(createdAt.getTime() + between(7, 45) * 864e5),
    });
  }

  return { profile: { ...STORE_PROFILE }, reps, customers, products: products.map(({ typicalQty, ...p }) => p), orders, orderItems, deals };
}
