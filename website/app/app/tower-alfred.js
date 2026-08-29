/* Tower Alfred runtime identity overlay.
   It activates only for the dedicated launcher URL and never mutates StarNet's
   ordinary source-mode surface. Configuration stays local and contains no secrets. */
'use strict';
(() => {
  const boot = (typeof window !== 'undefined' && window.__TOWER_ALFRED_BOOT__ && window.__TOWER_ALFRED_BOOT__.enabled === true)
    ? window.__TOWER_ALFRED_BOOT__
    : null;
  if (!boot) return;

  const configuredProduct = String(boot.productName || 'Tower Alfred');
  const defaults = {
    productName: configuredProduct,
    productMark: configuredProduct.toUpperCase(),
    supervisor: String(boot.supervisor || 'ALFRED'),
    role: String(boot.role || 'Supervisory Intelligence'),
    profile: String(boot.profile || 'default')
  };
  window.__TOWER_ALFRED__ = Object.freeze(defaults);
  document.documentElement.dataset.product = 'tower-alfred';
  document.title = window.__TOWER_ALFRED__.productMark;

  const replaceBrand = value => String(value)
    .replace(/\bSTARNET\b/g, window.__TOWER_ALFRED__.productMark)
    .replace(/\bStarNet\b/g, window.__TOWER_ALFRED__.productName);

  function brandNode(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const next = replaceBrand(root.nodeValue || '');
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const element = root.nodeType === Node.ELEMENT_NODE ? root : null;
    if (element && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(element.tagName)) {
      for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
        if (!element.hasAttribute(name)) continue;
        const value = element.getAttribute(name);
        const next = replaceBrand(value);
        if (next !== value) element.setAttribute(name, next);
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName)) continue;
      nodes.push(walker.currentNode);
    }
    nodes.forEach(brandNode);
  }

  function decorateTower() {
    const logo = document.querySelector('.logo-img');
    if (logo) logo.setAttribute('aria-label', defaults.productName);
    const logoSub = document.querySelector('#logo .logo-sub');
    if (logoSub) logoSub.textContent = `HERMES ACP · ${defaults.profile.toUpperCase()} PROFILE`;
    const splashLogo = document.querySelector('.sp-logo');
    if (splashLogo) {
      splashLogo.src = 'assets/tower-alfred/tower-alfred-icon.png';
      splashLogo.alt = defaults.productName;
    }
    const camLabel = document.querySelector('.cam-label');
    if (camLabel) camLabel.textContent = `${defaults.supervisor.toUpperCase()} SANCTUM · HERMES ACP`;
    const topbar = document.getElementById('topbar');
    if (topbar && !document.getElementById('tower-authority-badge')) {
      const badge = document.createElement('div');
      badge.id = 'tower-authority-badge';
      badge.setAttribute('role', 'status');
      badge.textContent = `${defaults.supervisor} ATTACHED · HERMES ACP · ${defaults.profile} PROFILE`;
      topbar.appendChild(badge);
    }
  }

  const onReady = () => { brandNode(document.body); decorateTower(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();

  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) brandNode(node);
  });
  document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { childList: true, subtree: true }), { once: true });
})();
