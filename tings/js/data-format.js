// ─────────────────────────────────────────────────────────────────────────
// FORMATTING + MISC — MOSTLY PURE. scheduleSummary/preferredSummary return
// human-readable strings; escapeHtml is the only DOM-aware function here and
// only exists to support innerHTML rendering in the view layer.
// ─────────────────────────────────────────────────────────────────────────

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function markSegments(value){
  const text = value.trim();
  if(Intl.Segmenter){
    return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(item=>item.segment);
  }
  return Array.from(text);
}

function cleanMark(value){
  return markSegments(value).slice(0,2).join('');
}

/** Curated emoji tile backgrounds — maps to CSS --{token}-bg / --{token}-icon. */
const EMOJI_BG_COLOR_TOKENS = ['teal','amber','red','purple','blue','green','pink','orange','indigo','cyan','lime','slate'];

function normalizeEmojiBgColor(value){
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMOJI_BG_COLOR_TOKENS.includes(token) ? token : '';
}

/** PURE: CSS custom-property pair for an emoji tile (or null when unset). */
function emojiBgStyleVars(token){
  const color = normalizeEmojiBgColor(token);
  if(!color)return null;
  return {
    bg:`var(--${color}-bg)`,
    icon:`var(--${color}-icon)`,
    token:color
  };
}

/** Inline style fragment for a pulse / mark with optional emoji bg. */
function emojiBgInlineStyle(h,fallbackBg = '',fallbackColor = ''){
  const vars = emojiBgStyleVars(h && h.emojiBgColor);
  if(vars){
    return `background:${vars.bg};color:${vars.icon};--emoji-bg:${vars.bg};`;
  }
  const parts = [];
  if(fallbackBg)parts.push(`background:${fallbackBg}`);
  if(fallbackColor)parts.push(`color:${fallbackColor}`);
  return parts.join(';');
}

function avgInterval(logs){
  const sorted = actualLogs(logs);
  if(sorted.length < 2)return null;
  let sum = 0;
  for(let i=1;i<sorted.length;i++)sum += sorted[i] - sorted[i-1];
  return Math.round(sum / (sorted.length - 1) / 86400000);
}
