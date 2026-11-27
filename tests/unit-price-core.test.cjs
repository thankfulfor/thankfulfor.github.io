const assert = require("node:assert/strict");
const core = require("../static/unit-price/core.js");

assert.equal(core.parseNumber("159,90"), 159.9);
assert.equal(core.parseNumber("1 250,50"), 1250.5);
assert.equal(core.parseNumber("12 руб"), null);

assert.deepEqual(core.calculateUnitPrice("199", "500", "g"), {
  value: 398,
  baseUnit: "kg",
  baseQuantity: .5
});

const liquid = core.calculateUnitPrice("159,90", "0,9", "l");
assert.equal(liquid.baseUnit, "l");
assert.ok(Math.abs(liquid.value - 177.6666667) < .0001);

assert.deepEqual(core.extractProductData("Молоко\nОбъем 900 мл\nЦена 159,90 руб."), {
  price: { value: 159.9, score: 14, lineIndex: 2 },
  quantity: { value: 900, unit: "ml", score: 11, lineIndex: 1 }
});

assert.equal(core.extractQuantity("Пищевая ценность на 100 г\nМасса нетто 450 г").value, 450);
assert.equal(core.extractPrice("ЦЕНА\n249 99 ₽").value, 249.99);
assert.equal(core.calculateUnitPrice("0", "500", "g"), null);

console.log("unit-price core: ok");
