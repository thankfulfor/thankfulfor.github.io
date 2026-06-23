function localizePagination() {
  const map = {
    Previous: 'Предыдущая',
    Next: 'Следующая',
  };

  const selectors = [
    '.rst-footer-buttons a',
    '.rst-content .pager a',
    '.rst-versions a',
  ];

  document.querySelectorAll(selectors.join(',')).forEach((el) => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;

    const hasLeftChevron = text.includes('«');
    const hasRightChevron = text.includes('»');
    const normalized = text.replace(/[«»]/g, '').trim();

    if (!map[normalized]) return;

    const translated = map[normalized];

    // Keep icon spans in footer buttons, replace only text nodes.
    let replaced = false;
    el.childNodes.forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const nodeText = node.nodeValue || '';
      if (/Previous|Next/.test(nodeText)) {
        node.nodeValue = nodeText.replace(/Previous|Next/g, translated);
        replaced = true;
      }
    });

    // For compact bottom bar links there are no icons, set full label.
    if (!replaced) {
      let label = translated;
      if (hasLeftChevron) label = `« ${label}`;
      if (hasRightChevron) label = `${label} »`;
      el.textContent = label;
    }
  });
}

function setPrimaryMenuActive() {
  const menuLinks = document.querySelectorAll('#menu a');
  if (!menuLinks.length) return;

  menuLinks.forEach((a) => {
    const span = a.querySelector('span');
    if (!span) return;
    const text = (a.textContent || '').trim();
    span.classList.toggle('active', text === 'Главная');
  });
}

function bindRussianShortWords(root = document) {
  const containers = root.querySelectorAll('.post-content, .md-content, .entry-content');
  if (!containers.length) return;

  const shortWords = [
    'а', 'в', 'во', 'и', 'к', 'ко', 'о', 'об', 'обо', 'от', 'по',
    'с', 'со', 'у', 'из', 'за', 'до', 'на', 'но'
  ];
  const re = new RegExp(`(^|\\s)(${shortWords.join('|')})\\s+`, 'gmi');
  const skipTags = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA']);

  containers.forEach((container) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      const parent = node.parentElement;
      if (!parent) return;
      if (skipTags.has(parent.tagName)) return;
      if (parent.closest('code, pre, kbd, samp, textarea, script, style')) return;
      if (!/[А-Яа-яЁё]/.test(node.nodeValue || '')) return;

      const updated = (node.nodeValue || '').replace(re, '$1$2\u00A0');
      if (updated !== node.nodeValue) node.nodeValue = updated;
    });
  });
}

document.addEventListener('DOMContentLoaded', localizePagination);
document.addEventListener('DOMContentLoaded', setPrimaryMenuActive);
document.addEventListener('DOMContentLoaded', () => bindRussianShortWords(document));
window.addEventListener('load', localizePagination);
window.addEventListener('load', setPrimaryMenuActive);
window.addEventListener('load', () => bindRussianShortWords(document));

// Theme scripts can re-render nav/footer after load, so relocalize on changes.
const observer = new MutationObserver(() => {
  localizePagination();
  setPrimaryMenuActive();
  bindRussianShortWords(document);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
