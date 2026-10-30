/** Piping-diagram glyphs. Variants describe appearance, not inferred valve duties. */
export function referenceSymbol(type, { fill, active = true, open = true, variant } = {}) {
  const bodyFill = fill || (active
    ? 'var(--fluid-fill,var(--diagram-active-fill))'
    : 'var(--diagram-idle-fill)');

  if (type === 'tank') {
    return `<g class="reference-tank"><circle r="46" fill="${bodyFill}"/><path d="M46 0h4" fill="none"/></g>`;
  }

  if (type === 'ground') {
    const sinking = variant === 'sink';
    // Plan-view buried continuation: a pipe ending in the drawing's curved break mark.
    // The mirrored marks retain the existing single connection at x = -36 / +36.
    const pipe = sinking ? 'M-36 0H14' : 'M36 0H-14';
    const continuation = sinking
      ? 'M14-13Q25-7 14 0Q3 7 14 13'
      : 'M-14-13Q-25-7-14 0Q-3 7-14 13';
    return `<g class="reference-ground ground-${sinking ? 'sink' : 'rise'}"><path class="ground-stem" d="${pipe}" fill="none" stroke-width="4"/><path class="ground-continuation" d="${continuation}" fill="none" stroke-width="2.2"/></g>`;
  }

  if (type === 'valve') {
    if (variant === 'riser') {
      // End view of an above-ground riser: bolted flange and diagonal handwheel.
      // The caller presents one center handle while preserving two logical valve sides.
      const bolts = Array.from({ length: 8 }, (_, index) => {
        const angle = (index * 45 + 22.5) * Math.PI / 180;
        const x = (18.5 * Math.cos(angle)).toFixed(2);
        const y = (18.5 * Math.sin(angle)).toFixed(2);
        return `<circle cx="${x}" cy="${y}" r="1.5" fill="currentColor" stroke="none"/>`;
      }).join('');
      const closed = open === false
        ? '<path d="m-7-7 14 14m0-14L-7 7" fill="none" stroke="var(--diagram-handle-closed)" stroke-width="2.5"/>'
        : '<path d="m-8 8 16-16" fill="none" stroke-width="2"/>';
      return `<g class="reference-valve reference-riser-valve"><circle r="23" fill="${bodyFill}"/><circle r="14" fill="${bodyFill}" stroke-width="1.6"/>${bolts}<path d="m-10 10-17 17m-3-9 12 12m-17-8 13 13" fill="none" stroke-width="1.8"/>${closed}</g>`;
    }
    const pipe = '<path d="M-36 0h12m48 0h12" fill="none"/>';
    const flanges = '<path d="M-29-19v38M29-19v38" fill="none" stroke-width="2"/>';
    const body = `<path d="M-24-15v30L0 0Zm48 0v30L0 0Z" fill="${bodyFill}"/>`;
    const roundCenter = variant === 'round'
      ? `<circle r="8" fill="${bodyFill}" stroke-width="1.8"/>`
      : '';
    const motor = variant === 'motor'
      ? `<path d="M0 0v-26" fill="none" stroke-width="1.8"/><rect x="-10" y="-43" width="20" height="17" rx=".5" fill="${bodyFill}" stroke-width="1.6"/><text x="0" y="-30" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-size="12" font-weight="600">M</text>`
      : '';
    const closed = open === false
      ? '<path d="m-6-6 12 12m0-12L-6 6" fill="none" stroke="var(--diagram-handle-closed)" stroke-width="2.3"/>'
      : '';
    return `<g class="reference-valve">${pipe}${flanges}${body}${roundCenter}${motor}${closed}</g>`;
  }

  if (type === 'filter') {
    const pipe = '<path d="M-36 0h14m44 0h14" fill="none"/>';
    const flanges = '<path d="M-29-15v30m-4-28v26M29-15v30m4-28v26" fill="none" stroke-width="1.8"/>';
    const rings = `<circle r="22" fill="${bodyFill}"/><circle r="14" fill="none" stroke-width="1.8"/>`;
    const basket = variant === 'basket'
      ? '<path d="M-10-6h20L7 9H-7ZM-4-4v11m8-11v11M-8 1H8" fill="none" stroke-width="1.3"/>'
      : '';
    return `<g class="reference-filter">${pipe}${flanges}${rings}${basket}</g>`;
  }

  return null;
}
