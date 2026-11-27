(function unitPriceApp() {
  "use strict";

  const core = window.UnitPriceCore;
  const elements = {
    openCamera: document.querySelector("#open-camera"),
    closeCamera: document.querySelector("#close-camera"),
    capturePhoto: document.querySelector("#capture-photo"),
    cameraPanel: document.querySelector("#camera-panel"),
    cameraVideo: document.querySelector("#camera-video"),
    captureCanvas: document.querySelector("#capture-canvas"),
    fileInput: document.querySelector("#file-input"),
    preview: document.querySelector("#preview"),
    previewImage: document.querySelector("#preview-image"),
    replacePhoto: document.querySelector("#replace-photo"),
    tips: document.querySelector("#tips"),
    scanPhoto: document.querySelector("#scan-photo"),
    scanLabel: document.querySelector(".scan-label"),
    scanProgress: document.querySelector(".scan-progress"),
    status: document.querySelector("#status"),
    price: document.querySelector("#price"),
    quantity: document.querySelector("#quantity"),
    unit: document.querySelector("#unit"),
    answerUnit: document.querySelector("#answer-unit"),
    answerValue: document.querySelector("#answer-value"),
    formula: document.querySelector("#formula"),
    recognizedDetails: document.querySelector("#recognized-details"),
    recognizedText: document.querySelector("#recognized-text"),
    resultCard: document.querySelector("#result-card")
  };

  let currentFile = null;
  let currentObjectUrl = null;
  let cameraStream = null;

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle("error", Boolean(isError));
  }

  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    elements.cameraVideo.srcObject = null;
    elements.cameraPanel.hidden = true;
  }

  async function openCamera() {
    setStatus("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Браузер не умеет открывать камеру. Загрузите снимок из галереи.", true);
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      elements.cameraVideo.srcObject = cameraStream;
      elements.cameraPanel.hidden = false;
      await elements.cameraVideo.play();
    } catch (error) {
      const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setStatus(denied ? "Доступ к камере закрыт. Разрешите его в браузере или загрузите фото." : "Не получилось открыть камеру. Загрузите фото из галереи.", true);
    }
  }

  function selectFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("Выберите изображение в формате JPEG, PNG, WebP или HEIC.", true);
      return;
    }
    currentFile = file;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    elements.previewImage.src = currentObjectUrl;
    elements.preview.hidden = false;
    elements.tips.hidden = true;
    elements.scanPhoto.disabled = false;
    elements.recognizedDetails.hidden = true;
    setStatus("Фото готово. Проверьте, что цена и количество видны в кадре.");
  }

  function capturePhoto() {
    const video = elements.cameraVideo;
    if (!video.videoWidth || !video.videoHeight) return;
    const canvas = elements.captureCanvas;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      selectFile(new File([blob], `price-${Date.now()}.jpg`, { type: "image/jpeg" }));
      stopCamera();
    }, "image/jpeg", .92);
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

  async function preprocessImage(file) {
    const image = await loadImage(file);
    const maxSide = 2000;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const contrast = 1.32;
    for (let index = 0; index < data.length; index += 4) {
      const gray = .299 * data[index] + .587 * data[index + 1] + .114 * data[index + 2];
      const adjusted = Math.max(0, Math.min(255, contrast * (gray - 128) + 128));
      data[index] = adjusted;
      data[index + 1] = adjusted;
      data[index + 2] = adjusted;
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function setLoading(loading, progress) {
    elements.scanPhoto.disabled = loading;
    elements.scanPhoto.classList.toggle("is-loading", loading);
    elements.scanLabel.textContent = loading ? "Читаю ценник…" : "Распознать ещё раз";
    elements.scanProgress.style.width = `${Math.round((progress || 0) * 100)}%`;
  }

  async function recognizePhoto() {
    if (!currentFile || !window.Tesseract) {
      setStatus("Модуль распознавания не загрузился. Проверьте интернет и обновите страницу.", true);
      return;
    }

    let worker;
    setLoading(true, 0);
    setStatus("При первом запуске загружаются языковые данные. Это может занять около минуты.");
    try {
      const prepared = await preprocessImage(currentFile);
      worker = await window.Tesseract.createWorker("rus+eng", 1, {
        logger(message) {
          if (typeof message.progress === "number") {
            setLoading(true, message.progress);
            if (message.status === "recognizing text") setStatus(`Распознаю текст: ${Math.round(message.progress * 100)}%`);
          }
        }
      });
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: window.Tesseract.PSM.SPARSE_TEXT
      });
      const result = await worker.recognize(prepared);
      const text = result.data.text.trim();
      const extracted = core.extractProductData(text);

      elements.recognizedText.textContent = text || "Текст не найден";
      elements.recognizedDetails.hidden = false;
      elements.price.value = extracted.price ? String(extracted.price.value).replace(".", ",") : "";
      elements.quantity.value = extracted.quantity ? String(extracted.quantity.value).replace(".", ",") : "";
      if (extracted.quantity) {
        elements.unit.value = extracted.quantity.unit;
      }
      updateCalculation();

      if (extracted.price && extracted.quantity) {
        setStatus("Готово. Сверьте цену и количество с фотографией.");
      } else if (text) {
        setStatus("Текст прочитан не полностью. Заполните недостающие поля вручную.", true);
      } else {
        setStatus("Не удалось прочитать цифры. Попробуйте более чёткий снимок или заполните поля вручную.", true);
      }
      elements.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      console.error(error);
      setStatus("Распознавание не завершилось. Проверьте соединение или попробуйте другое фото.", true);
    } finally {
      if (worker) await worker.terminate();
      setLoading(false, 0);
    }
  }

  const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const decimals = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

  function updateCalculation() {
    const result = core.calculateUnitPrice(elements.price.value, elements.quantity.value, elements.unit.value);
    const isVolume = elements.unit.value === "ml" || elements.unit.value === "l";
    elements.answerUnit.textContent = isVolume ? "1 л" : "1 кг";
    if (!result) {
      elements.answerValue.textContent = "—";
      elements.formula.textContent = "Введите цену и количество";
      return;
    }
    const price = core.parseNumber(elements.price.value);
    elements.answerValue.textContent = rubles.format(result.value).replace(" ₽", " ₽");
    elements.formula.textContent = `${decimals.format(price)} ₽ ÷ ${decimals.format(result.baseQuantity)} ${result.baseUnit === "kg" ? "кг" : "л"}`;
  }

  elements.openCamera.addEventListener("click", openCamera);
  elements.closeCamera.addEventListener("click", stopCamera);
  elements.capturePhoto.addEventListener("click", capturePhoto);
  elements.fileInput.addEventListener("change", (event) => selectFile(event.target.files[0]));
  elements.replacePhoto.addEventListener("click", () => elements.fileInput.click());
  elements.scanPhoto.addEventListener("click", recognizePhoto);
  [elements.price, elements.quantity].forEach((input) => input.addEventListener("input", updateCalculation));
  elements.unit.addEventListener("change", updateCalculation);
  window.addEventListener("pagehide", stopCamera);
  updateCalculation();
})();
