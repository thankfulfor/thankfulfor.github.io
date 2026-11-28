(function comparisonApp() {
  "use strict";

  const core = window.UnitPriceCore;
  const elements = {
    file: document.querySelector("#compare-file"),
    fileCard: document.querySelector("#compare-file-card"),
    fileName: document.querySelector("#compare-file-name"),
    fileMeta: document.querySelector("#compare-file-meta"),
    preview: document.querySelector("#compare-preview"),
    replace: document.querySelector("#compare-replace"),
    scan: document.querySelector("#compare-scan"),
    scanLabel: document.querySelector(".compare-scan-label"),
    progress: document.querySelector(".compare-progress"),
    status: document.querySelector("#compare-status"),
    results: document.querySelector("#comparison-results"),
    topProducts: document.querySelector("#top-products"),
    productTable: document.querySelector("#product-table"),
    productsCount: document.querySelector("#products-count"),
    recognized: document.querySelector("#compare-recognized"),
    recognizedText: document.querySelector("#compare-recognized-text")
  };

  const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let selectedFile = null;
  let previewUrl = null;
  let products = [];

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  }

  function isMhtml(file) {
    return /\.(mhtml?|mht)$/i.test(file.name) || file.type === "message/rfc822" || file.type === "multipart/related";
  }

  function setStatus(message, error) {
    elements.status.textContent = message;
    elements.status.classList.toggle("error", Boolean(error));
  }

  function setLoading(loading, progress, label) {
    elements.scan.disabled = loading;
    elements.scan.classList.toggle("is-loading", loading);
    elements.scanLabel.textContent = loading ? (label || "Обрабатываю файл…") : "Обработать ещё раз";
    elements.progress.style.width = `${Math.round((progress || 0) * 100)}%`;
  }

  function selectFile(file) {
    if (!file || (!file.type.startsWith("image/") && !isMhtml(file))) {
      setStatus("Выберите MHTML или изображение в формате JPEG, PNG или WebP.", true);
      return;
    }
    selectedFile = file;
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${isMhtml(file) ? "Сохранённая страница" : "Скриншот"} · ${formatBytes(file.size)}`;
    elements.fileCard.hidden = false;
    elements.scan.disabled = false;
    elements.results.hidden = true;
    elements.recognized.hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (file.type.startsWith("image/")) {
      previewUrl = URL.createObjectURL(file);
      elements.preview.src = previewUrl;
      elements.preview.hidden = false;
    } else {
      previewUrl = null;
      elements.preview.hidden = true;
    }
    setStatus("Файл готов к обработке.");
  }

  function decodeQuotedPrintable(value) {
    const input = value.replace(/=\r?\n/g, "");
    const bytes = [];
    for (let index = 0; index < input.length; index += 1) {
      if (input[index] === "=" && /^[0-9a-f]{2}$/i.test(input.slice(index + 1, index + 3))) {
        bytes.push(Number.parseInt(input.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        const code = input.charCodeAt(index);
        if (code < 128) bytes.push(code);
        else bytes.push(...new TextEncoder().encode(input[index]));
      }
    }
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }

  function extractHtmlFromMhtml(raw) {
    const boundaryMatch = raw.match(/boundary=(?:"([^"]+)"|([^;\r\n]+))/i);
    if (!boundaryMatch) throw new Error("mhtml-boundary");
    const boundary = boundaryMatch[1] || boundaryMatch[2].trim();
    const parts = raw.split(`--${boundary}`);
    const htmlPart = parts.find((part) => /Content-Type:\s*text\/html/i.test(part));
    if (!htmlPart) throw new Error("mhtml-html");
    const separator = htmlPart.search(/\r?\n\r?\n/);
    const headers = htmlPart.slice(0, separator);
    const body = htmlPart.slice(separator).replace(/^\r?\n\r?\n/, "");
    if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) {
      const binary = atob(body.replace(/\s+/g, ""));
      return new TextDecoder("utf-8").decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    }
    return /Content-Transfer-Encoding:\s*quoted-printable/i.test(headers) ? decodeQuotedPrintable(body) : body;
  }

  function getPriceFromLabel(label) {
    const discounted = label.match(/цена со скидкой\s*-\s*(\d+(?:[.,]\d+)?)/iu);
    const full = label.match(/полная цена\s*-\s*(\d+(?:[.,]\d+)?)/iu);
    return core.parseNumber((discounted || full || [])[1] || "");
  }

  function nearestStoreName(card, headings) {
    let name = "";
    headings.forEach((heading) => {
      if (heading.compareDocumentPosition(card) & 4) name = heading.textContent.trim();
    });
    return name;
  }

  function parseMhtmlProducts(raw) {
    const html = extractHtmlFromMhtml(raw);
    const documentCopy = new DOMParser().parseFromString(html, "text/html");
    const headings = Array.from(documentCopy.querySelectorAll("h5"));
    const seen = new Set();
    return Array.from(documentCopy.querySelectorAll('a[data-qa^="products_grid_item_"]'))
      .map((card) => {
        const label = card.getAttribute("aria-label") || "";
        const nameNode = card.querySelector('[data-qa="product_snippet_name"]');
        const name = (nameNode ? nameNode.textContent : label.split(/\.\s*(?:Полная|Цена)/iu)[0]).replace(/\s+/g, " ").trim();
        const text = card.textContent.replace(/\s+/g, " ").trim();
        const price = getPriceFromLabel(label);
        const overrides = {
          name: name || "Товар",
          store: nearestStoreName(card, headings),
          url: card.href || ""
        };
        if (price) overrides.price = price;
        const product = core.productFromText(text, overrides);
        const key = `${product.store}|${product.url}|${product.name}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return product;
      })
      .filter(Boolean);
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image-load")); };
      image.src = url;
    });
  }

  function makeRowCanvas(image, top, height) {
    const targetWidth = 1600;
    const scale = targetWidth / image.naturalWidth;
    const sourceTop = Math.max(0, Math.round(top + height * .5));
    const sourceHeight = Math.max(1, Math.round(height * .5));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.round(sourceHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, sourceTop, image.naturalWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = .299 * pixels.data[index] + .587 * pixels.data[index + 1] + .114 * pixels.data[index + 2];
      const adjusted = Math.max(0, Math.min(255, 1.45 * (gray - 128) + 128));
      pixels.data[index] = adjusted;
      pixels.data[index + 1] = adjusted;
      pixels.data[index + 2] = adjusted;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  function splitBlocksByColumn(data, width) {
    const columns = [[], []];
    (data.blocks || []).forEach((block) => {
      const box = block.bbox || {};
      const center = ((box.x0 || 0) + (box.x1 || 0)) / 2;
      const text = String(block.text || "").trim();
      if (text) columns[center < width / 2 ? 0 : 1].push(text);
    });
    if (!columns[0].length && !columns[1].length && data.text) {
      const lines = data.text.split(/\n+/).filter(Boolean);
      lines.forEach((line, index) => columns[index % 2].push(line));
    }
    return columns.map((column) => column.join("\n").trim());
  }

  async function recognizeScreenshot(file) {
    if (!window.Tesseract) throw new Error("tesseract-missing");
    const image = await loadImage(file);
    if (image.naturalWidth < 600) {
      const error = new Error("low-resolution");
      error.imageWidth = image.naturalWidth;
      throw error;
    }
    const start = Math.round(image.naturalWidth * .38);
    const end = Math.max(start + 1, image.naturalHeight - Math.round(image.naturalWidth * .45));
    const rowHeight = Math.max(80, Math.round(image.naturalWidth * .87));
    const rows = Math.max(1, Math.min(20, Math.floor((end - start) / rowHeight)));
    let currentRow = 0;
    const worker = await window.Tesseract.createWorker("rus+eng", 1, {
      logger(message) {
        if (typeof message.progress === "number") {
          const totalProgress = (currentRow + message.progress) / rows;
          setLoading(true, totalProgress, `Читаю карточки: ${currentRow + 1} из ${rows}`);
        }
      }
    });
    const found = [];
    const recognized = [];
    try {
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: window.Tesseract.PSM.SPARSE_TEXT
      });
      for (currentRow = 0; currentRow < rows; currentRow += 1) {
        const canvas = makeRowCanvas(image, start + currentRow * rowHeight, rowHeight);
        const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
        const columns = splitBlocksByColumn(result.data, canvas.width);
        columns.forEach((text, columnIndex) => {
          if (!text) return;
          recognized.push(`Ряд ${currentRow + 1}, ${columnIndex === 0 ? "слева" : "справа"}:\n${text}`);
          const product = core.productFromText(text);
          if (product.price || product.quantity || product.name !== "Товар") found.push(product);
        });
      }
    } finally {
      await worker.terminate();
    }
    return { products: found, text: recognized.join("\n\n") };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTop() {
    const ranked = core.rankProducts(products, 3);
    if (!ranked.length) {
      elements.topProducts.innerHTML = '<p class="empty-top">Заполните цену и количество хотя бы у одного товара.</p>';
      return;
    }
    elements.topProducts.innerHTML = ranked.map((entry, rank) => {
      const item = entry.product;
      const title = item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)}</a>` : `<strong>${escapeHtml(item.name)}</strong>`;
      return `<article class="top-product">
        <span class="top-rank">${rank + 1}</span>
        <div>${title}${item.store ? `<small>${escapeHtml(item.store)}</small>` : ""}</div>
        <output>${rubles.format(entry.result.value).replace(" ₽", " ₽")}<small>за 1 ${entry.result.baseUnit === "kg" ? "кг" : "л"}</small></output>
      </article>`;
    }).join("");
  }

  function renderEditor() {
    elements.productsCount.textContent = `${products.length} ${products.length === 1 ? "товар" : products.length < 5 ? "товара" : "товаров"}`;
    elements.productTable.innerHTML = products.map((product, index) => {
      const unitResult = core.getProductUnitPrice(product);
      return `<div class="product-row" data-index="${index}">
        <label class="product-name-field"><span>Товар</span><input data-field="name" value="${escapeHtml(product.name)}"></label>
        <label><span>Цена, ₽</span><input data-field="price" inputmode="decimal" value="${product.price == null ? "" : escapeHtml(String(product.price).replace(".", ","))}"></label>
        <label><span>Количество</span><input data-field="quantity" inputmode="decimal" value="${product.quantity == null ? "" : escapeHtml(String(product.quantity).replace(".", ","))}"></label>
        <label><span>Единица</span><span class="select-wrap"><select data-field="unit">
          <option value="g"${product.unit === "g" ? " selected" : ""}>г</option>
          <option value="kg"${product.unit === "kg" ? " selected" : ""}>кг</option>
          <option value="ml"${product.unit === "ml" ? " selected" : ""}>мл</option>
          <option value="l"${product.unit === "l" ? " selected" : ""}>л</option>
        </select></span></label>
        <div class="product-unit-price"><span>За единицу</span><strong>${unitResult ? rubles.format(unitResult.value).replace(" ₽", " ₽") : "—"}</strong><small>${unitResult ? `за 1 ${unitResult.baseUnit === "kg" ? "кг" : "л"}` : "нужны цена и количество"}</small></div>
        <button class="remove-product" type="button" data-remove="${index}" aria-label="Удалить ${escapeHtml(product.name)}">Удалить</button>
      </div>`;
    }).join("");
    renderTop();
  }

  function updateProduct(event) {
    const row = event.target.closest(".product-row");
    const field = event.target.dataset.field;
    if (!row || !field) return;
    const product = products[Number(row.dataset.index)];
    if (field === "price" || field === "quantity") product[field] = core.parseNumber(event.target.value);
    else product[field] = event.target.value;
    product.directUnitPrice = null;
    product.baseUnit = null;
    renderEditor();
  }

  async function analyze() {
    if (!selectedFile) return;
    setLoading(true, 0);
    setStatus(isMhtml(selectedFile) ? "Читаю карточки из сохранённой страницы…" : "Распознаю карточки на скриншоте. Это может занять несколько минут.");
    try {
      if (isMhtml(selectedFile)) {
        products = parseMhtmlProducts(await selectedFile.text());
        elements.recognized.hidden = true;
      } else {
        const result = await recognizeScreenshot(selectedFile);
        products = result.products;
        elements.recognizedText.textContent = result.text || "Текст не найден";
        elements.recognized.hidden = false;
      }
      if (!products.length) throw new Error("products-empty");
      renderEditor();
      elements.results.hidden = false;
      setStatus(`Найдено товаров: ${products.length}. Проверьте цифры перед выбором.`);
      elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      console.error(error);
      if (error.message === "low-resolution") {
        setStatus(`Скриншот слишком сжат: ширина ${error.imageWidth} px. Загрузите оригинал шириной от 600 px, не пересылая его как фото в мессенджере.`, true);
      } else {
        setStatus("Не удалось собрать список. Попробуйте другой файл или более чёткий скриншот.", true);
      }
    } finally {
      setLoading(false, 0);
    }
  }

  elements.file.addEventListener("change", (event) => selectFile(event.target.files[0]));
  elements.replace.addEventListener("click", () => elements.file.click());
  elements.scan.addEventListener("click", analyze);
  elements.productTable.addEventListener("change", updateProduct);
  elements.productTable.addEventListener("input", (event) => {
    if (event.target.dataset.field !== "name") return;
    const row = event.target.closest(".product-row");
    if (!row) return;
    products[Number(row.dataset.index)].name = event.target.value;
    renderTop();
  });
  elements.productTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    products.splice(Number(button.dataset.remove), 1);
    renderEditor();
  });
})();
