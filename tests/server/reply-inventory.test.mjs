// Reply drafts that know the inventory (server/agent/reply-inventory.js, decision #57): the products an email mentions
// are found in the catalogue, and their live stock and price go to the drafter, so "10 solar panels" with 9 in stock
// gets a reply that says so. The owner still reviews and sends every reply.
import assert from "node:assert/strict";
import test from "node:test";
import { matchProducts, inventoryFacts } from "../../server/agent/reply-inventory.js";

const products = [
  { sku: "CH-0001", name: "Solar panel 450W", unit_price: 189, stock: 9, unit: "panel", reorder_level: 10 },
  { sku: "CH-0002", name: "Inverter battery 200Ah (lithium)", unit_price: 1450, stock: 0, unit: "battery", reorder_level: 4 },
  { sku: "CH-0010", name: "Cordless drill/driver 20V kit", unit_price: 129, stock: 3, unit: "kit", reorder_level: 5 },
  { sku: "CH-0020", name: "LED bulb 9W (pack of 4)", unit_price: 8.5, stock: 240, unit: "pack", reorder_level: 50 },
  { sku: "CH-0021", name: "LED bulb 12W (pack of 4)", unit_price: 10.5, stock: 120, unit: "pack", reorder_level: 50 },
  { sku: "CH-0030", name: "PVC pipe 1/2 in (3 m)", unit_price: 4.2, stock: 500, unit: "length", reorder_level: 100 },
];
const skus = (text) => matchProducts(text, products).map((p) => p.sku);

test("finds the products an email asks about, by name (plurals too) or SKU", () => {
  assert.deepEqual(skus("Hi, can we order 10 solar panels for next week?"), ["CH-0001"]);
  assert.deepEqual(skus("Please quote CH-0010 x 5"), ["CH-0010"]);
  assert.deepEqual(skus("Do you have the cordless drills in stock?"), ["CH-0010"]);
  assert.deepEqual(skus("We need inverter batteries, the lithium ones").sort(), ["CH-0002"]);
  assert.deepEqual(skus("200 LED bulbs please").sort(), ["CH-0020", "CH-0021"], "both sizes: the drafter asks which");
  assert.deepEqual(skus("Thanks for lunch yesterday, see you soon"), []);
  assert.deepEqual(skus("the panel discussion was great"), [], "one generic word isn't a product");
});

test("never more than a handful of products, best matches first", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ sku: `X-${i}`, name: `Solar panel ${i}0W`, unit_price: 1, stock: 1, unit: "panel" }));
  assert.equal(matchProducts("solar panels", many).length, 5);
});

test("the facts the drafter gets: stock, price and what to watch, nothing else", () => {
  const facts = inventoryFacts(matchProducts("10 solar panels and a lithium inverter battery", products));
  assert.deepEqual(facts.find((f) => f.sku === "CH-0001"), { sku: "CH-0001", name: "Solar panel 450W", inStock: 9, unit: "panel", listPriceUSD: 189, status: "low" });
  assert.equal(facts.find((f) => f.sku === "CH-0002").status, "out of stock");
  assert.equal(inventoryFacts(matchProducts("PVC pipe", products))[0].status, "in stock");
});
