// Viewport tier detection. Sets body[data-tier] and emits a tierchange event.

function debounce(fn, ms) {
  let id = null;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

function computeTier() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 600) return 'mobile-portrait';
  if (h < 500) return 'mobile-landscape';
  if (w < 1024) return 'tablet-portrait';
  if (w < 1280) return 'tablet-landscape';
  return 'desktop';
}

function applyTier(tier) {
  document.body.setAttribute('data-tier', tier);
  document.dispatchEvent(new CustomEvent('tierchange', { detail: { tier } }));
}

let currentTier = computeTier();
applyTier(currentTier);

// Dispatch an initial tierchange after a tick so listeners from other deferred
// scripts have a chance to register.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => applyTier(currentTier), 0);
  }, { once: true });
} else {
  setTimeout(() => applyTier(currentTier), 0);
}

// Initial sync after scripts have loaded.
function initialSync() {
  document.dispatchEvent(new CustomEvent('tierchange', { detail: { tier: currentTier } }));
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialSync, { once: true });
} else {
  setTimeout(initialSync, 0);
}

const onResize = debounce(() => {
  const next = computeTier();
  if (next !== currentTier) {
    currentTier = next;
    applyTier(next);
  }
}, 120);

window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onResize);
}

function isWide() {
  return currentTier !== 'mobile-portrait';
}

function isPaneTier() {
  return currentTier === 'mobile-landscape'
    || currentTier === 'tablet-portrait'
    || currentTier === 'tablet-landscape'
    || currentTier === 'desktop';
}

function getTier() {
  return currentTier;
}
