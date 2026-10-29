/* Text annotations have geometry for editing, but no oil ports or flow state. */
const textMarkEscape = value => String(value).replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[character]));
const textMarkNumber = value => String(Math.round(value * 1000) / 1000);

/** Normalize annotation fields without changing the node or inventing pipe data. */
export function normalizeTextMark(node = {}) {
  const value = node && typeof node === 'object' ? node : {};
  const content = value.text == null ? '文字標記' : String(value.text);
  const text = Array.from(content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')).slice(0, 2000).join('');
  return {
    text,
    fontSize: Number.isFinite(value.fontSize) ? Math.max(8, Math.min(72, value.fontSize)) : 18,
    textColor: typeof value.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.textColor)
      ? value.textColor : 'auto',
    textAlign: ['start', 'middle', 'end'].includes(value.textAlign) ? value.textAlign : 'start',
    bold: value.bold === true
  };
}

function textMarkGeometry(node) {
  const style = normalizeTextMark(node);
  const lines = style.text.split(/\r\n|\r|\n/);
  const characterWidth = character => {
    if (/\s/.test(character)) return .34;
    if (/^[\u0000-\u007f]$/.test(character)) return /[ilI1.,:;'`!|]/.test(character) ? .3 : /[MW@#%&]/.test(character) ? .9 : .62;
    return 1;
  };
  const width = Math.max(style.fontSize, ...lines.map(line => Array.from(line)
    .reduce((sum, character) => sum + characterWidth(character), 0) * style.fontSize * (style.bold ? 1.05 : 1)));
  const lineHeight = style.fontSize * 1.4;
  const left = style.textAlign === 'middle' ? -width / 2 : style.textAlign === 'end' ? -width : 0;
  const padding = 6;
  return {style, lines, lineHeight,
    x: left - padding, y: -style.fontSize - padding,
    width: width + padding * 2,
    height: style.fontSize * 1.3 + (lines.length - 1) * lineHeight + padding * 2};
}

/** Inner SVG only; the caller positions/rotates its wrapper and shows selection via CSS. */
export function textMarkMarkup(node) {
  const geometry = textMarkGeometry(node);
  const {style, lines, lineHeight} = geometry;
  const box = `x="${textMarkNumber(geometry.x)}" y="${textMarkNumber(geometry.y)}" width="${textMarkNumber(geometry.width)}" height="${textMarkNumber(geometry.height)}"`;
  const color = style.textColor === 'auto' ? 'var(--diagram-label)' : style.textColor;
  const linesMarkup = lines.map((line, index) => `<tspan x="0" ${index ? `dy="${textMarkNumber(lineHeight)}"` : 'y="0"'}>${textMarkEscape(line)}</tspan>`).join('');
  return `<rect class="text-mark-hit" ${box} fill="transparent" pointer-events="all"/><rect class="text-mark-selection" ${box} rx="3" fill="none" pointer-events="none"/><text class="text-mark-content" x="0" y="0" text-anchor="${style.textAlign}" fill="${color}" font-size="${textMarkNumber(style.fontSize)}" font-weight="${style.bold ? 700 : 400}" stroke="none" xml:space="preserve">${linesMarkup}</text>`;
}

/** World corners approximate the full multi-line annotation for fit-to-view. */
export function textMarkBounds(node = {}) {
  const value = node && typeof node === 'object' ? node : {};
  const geometry = textMarkGeometry(value);
  const x = Number.isFinite(value.x) ? value.x : 0;
  const y = Number.isFinite(value.y) ? value.y : 0;
  const rotation = Number.isFinite(value.rotation) ? (value.rotation % 360) * Math.PI / 180 : 0;
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  return [
    [geometry.x, geometry.y],
    [geometry.x + geometry.width, geometry.y],
    [geometry.x + geometry.width, geometry.y + geometry.height],
    [geometry.x, geometry.y + geometry.height]
  ].map(([localX, localY]) => ({
    x: x + localX * cosine - localY * sine,
    y: y + localX * sine + localY * cosine
  }));
}
