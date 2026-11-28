(function attachUnitPriceCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UnitPriceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const UNIT_ALIASES = {
    "г": "g", "гр": "g", g: "g",
    "кг": "kg", kg: "kg",
    "мл": "ml", ml: "ml",
    "л": "l", l: "l"
  };

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const cleaned = value.trim().replace(/\s+/g, "").replace(",", ".");
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeOcrText(text) {
    return String(text || "")
      .replace(/[ОO](?=\d)|(?<=\d)[ОO]/g, "0")
      .replace(/[ЗЗ](?=\d)|(?<=\d)[ЗЗ]/g, "3")
      .replace(/[–—]/g, "-")
      .replace(/\u00a0/g, " ");
  }

  function calculateUnitPrice(price, quantity, unit) {
    const parsedPrice = parseNumber(price);
    const parsedQuantity = parseNumber(quantity);
    if (!parsedPrice || !parsedQuantity || parsedPrice <= 0 || parsedQuantity <= 0) return null;

    let baseQuantity;
    let baseUnit;
    if (unit === "g") { baseQuantity = parsedQuantity / 1000; baseUnit = "kg"; }
    else if (unit === "kg") { baseQuantity = parsedQuantity; baseUnit = "kg"; }
    else if (unit === "ml") { baseQuantity = parsedQuantity / 1000; baseUnit = "l"; }
    else if (unit === "l") { baseQuantity = parsedQuantity; baseUnit = "l"; }
    else return null;

    return { value: parsedPrice / baseQuantity, baseUnit, baseQuantity };
  }

  function extractQuantity(text) {
    const normalized = normalizeOcrText(text).toLowerCase();
    const candidates = [];
    normalized.split(/\n+/).forEach((line, lineIndex) => {
      const pattern = /(\d{1,4}(?:[.,]\d{1,3})?)\s*(кг|kg|гр|г|ml|мл|l|л|g)(?![\p{L}])/giu;
      let match;
      while ((match = pattern.exec(line))) {
        const value = parseNumber(match[1]);
        const unit = UNIT_ALIASES[match[2].toLowerCase()];
        if (!value || !unit) continue;

        const inBase = unit === "g" || unit === "ml" ? value / 1000 : value;
        if (inBase < .005 || inBase > 100) continue;

        let score = unit === "kg" || unit === "l" ? 5 : 4;
        if (/вес|масса|объ[её]м|нетто|net|volume/.test(line)) score += 5;
        if (/на\s*100|per\s*100|\/\s*100/.test(line)) score -= 8;
        if (/₽|руб|цена|стоим/.test(line)) score -= 3;
        if (inBase >= .1 && inBase <= 10) score += 2;
        candidates.push({ value, unit, score, lineIndex });
      }
    });
    candidates.sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex);
    return candidates[0] || null;
  }

  function extractPrice(text) {
    const normalized = normalizeOcrText(text).toLowerCase();
    const candidates = [];
    normalized.split(/\n+/).forEach((line, lineIndex) => {
      const compactPrice = /(\d{1,5})\s+(\d{2})\s*(₽|руб(?:\.|лей|ля)?|р\.)/giu;
      let match;
      while ((match = compactPrice.exec(line))) {
        const value = parseNumber(`${match[1]}.${match[2]}`);
        if (value) candidates.push({ value, score: 12 + (/цена|итого|стоим/.test(line) ? 4 : 0), lineIndex });
      }

      const currencyPrice = /(\d{1,5}(?:[.,]\d{1,2})?)\s*(₽|руб(?:\.|лей|ля)?|р\.)/giu;
      while ((match = currencyPrice.exec(line))) {
        const value = parseNumber(match[1]);
        if (value) candidates.push({ value, score: 10 + (/цена|итого|стоим/.test(line) ? 4 : 0), lineIndex });
      }

      if (!/(кг|kg|гр|\bг\b|мл|ml|\bл\b|\bl\b)/iu.test(line)) {
        const spaced = line.match(/\b(\d{1,4})[\s.,]+(\d{2})\b/);
        if (spaced) {
          const value = parseNumber(`${spaced[1]}.${spaced[2]}`);
          if (value) candidates.push({ value, score: 5 + (/цена|итого|стоим/.test(line) ? 4 : 0), lineIndex });
        }
      }
    });
    candidates.sort((a, b) => b.score - a.score || a.lineIndex - b.lineIndex);
    return candidates[0] || null;
  }

  function extractProductData(text) {
    return { price: extractPrice(text), quantity: extractQuantity(text) };
  }

  function extractDirectUnitPrice(text) {
    const normalized = normalizeOcrText(text).toLowerCase();
    const match = normalized.match(/(\d{1,6}(?:[\s.,]\d{1,2})?)\s*₽?\s*(?:за|\/)?\s*1\s*(кг|kg|л|l)(?![\p{L}])/iu);
    if (!match) return null;
    const value = parseNumber(match[1].replace(/\s+(?=\d{2}$)/, "."));
    if (!value || value <= 0) return null;
    return { value, baseUnit: /кг|kg/iu.test(match[2]) ? "kg" : "l" };
  }

  function cleanProductName(text) {
    const lines = normalizeOcrText(text)
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line) => !/^[-−]?\d{1,6}(?:[\s.,]\d{1,2})?\s*(?:₽|р\.?|p)$/iu.test(line))
      .filter((line) => !/₽\s*(?:за|\/)\s*1\s*(?:кг|л)/iu.test(line))
      .filter((line) => !/^\d+(?:[.,]\d+)?\s*(?:г|гр|кг|мл|л)$/iu.test(line));
    return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 180) || "Товар";
  }

  function productFromText(text, overrides) {
    const source = String(text || "");
    const direct = extractDirectUnitPrice(source);
    const priceCandidate = extractPrice(source);
    const withoutDirect = source.replace(/\d{1,6}(?:[\s.,]\d{1,2})?\s*₽?\s*(?:за|\/)\s*1\s*(?:кг|kg|л|l)/giu, "");
    const quantityCandidate = extractQuantity(withoutDirect);
    const product = Object.assign({
      name: cleanProductName(source),
      price: priceCandidate ? priceCandidate.value : null,
      quantity: quantityCandidate ? quantityCandidate.value : null,
      unit: quantityCandidate ? quantityCandidate.unit : "g",
      directUnitPrice: direct ? direct.value : null,
      baseUnit: direct ? direct.baseUnit : null,
      store: "",
      url: "",
      sourceText: source.trim()
    }, overrides || {});

    if ((!product.quantity || !product.unit) && product.price && product.directUnitPrice && product.baseUnit) {
      const baseQuantity = product.price / product.directUnitPrice;
      if (baseQuantity > 0 && baseQuantity < 1) {
        product.quantity = Math.round(baseQuantity * 1000);
        product.unit = product.baseUnit === "kg" ? "g" : "ml";
      } else if (baseQuantity > 0) {
        product.quantity = Number(baseQuantity.toFixed(3));
        product.unit = product.baseUnit;
      }
    }
    return product;
  }

  function getProductUnitPrice(product) {
    const calculated = calculateUnitPrice(product.price, product.quantity, product.unit);
    if (calculated) return { value: calculated.value, baseUnit: calculated.baseUnit };
    if (product.directUnitPrice && product.baseUnit) return { value: product.directUnitPrice, baseUnit: product.baseUnit };
    return null;
  }

  function rankProducts(products, limit) {
    return (products || [])
      .map((product, index) => ({ product, index, result: getProductUnitPrice(product) }))
      .filter((entry) => entry.result && entry.result.value > 0)
      .sort((a, b) => a.result.value - b.result.value)
      .slice(0, limit || 3);
  }

  return {
    parseNumber,
    normalizeOcrText,
    calculateUnitPrice,
    extractQuantity,
    extractPrice,
    extractProductData,
    extractDirectUnitPrice,
    cleanProductName,
    productFromText,
    getProductUnitPrice,
    rankProducts
  };
});
