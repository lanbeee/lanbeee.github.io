// Viewport tier detection. Sets body[data-tier], body[data-pane-count] and
// emits a tierchange event.

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

// Pane count is driven purely by horizontal space. Each pane is 480px wide
// (mobile-portrait's max width), so:
//   < 720px  → 1 pane   (any phone, plus narrow iPad portrait)
//   720-1199 → 2 panes (iPad portrait / landscape, most tablets)
//   >= 1200  → 3 panes (large tablet landscape / desktop)
function computePaneCount() {
  const w = window.innerWidth;
  if (w >= 1200) return 3;
  if (w >= 720) return 2;
  return 1;
}

function applyTier(tier) {
  document.body.setAttribute('data-tier', tier);
  document.dispatchEvent(new CustomEvent('tierchange', { detail: { tier } }));
}

function applyPaneCount(count) {
  document.body.setAttribute('data-pane-count', String(count));
  // Reuse tierchange so existing listeners (sheet reset, reparent, etc.) run
  // when the pane count crosses a threshold.
  document.dispatchEvent(new CustomEvent('tierchange', { detail: { tier: currentTier, paneCount: count } }));
}

let currentTier = computeTier();
let currentPaneCount = computePaneCount();
applyTier(currentTier);
applyPaneCount(currentPaneCount);

// Dispatch an initial tierchange after a tick so listeners from other deferred
// scripts have a chance to register.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      applyTier(currentTier);
      applyPaneCount(currentPaneCount);
    }, 0);
  }, { once: true });
} else {
  setTimeout(() => {
    applyTier(currentTier);
    applyPaneCount(currentPaneCount);
  }, 0);
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
  const nextTier = computeTier();
  const nextCount = computePaneCount();
  if (nextTier !== currentTier) {
    currentTier = nextTier;
    applyTier(nextTier);
  }
  if (nextCount !== currentPaneCount) {
    currentPaneCount = nextCount;
    applyPaneCount(nextCount);
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
  return currentPaneCount >= 2;
}

function getTier() {
  return currentTier;
}

function getPaneCount() {
  return currentPaneCount;
}
