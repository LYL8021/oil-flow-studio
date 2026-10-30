/** Draw oil pipes at arbitrary angles; bridge marks never imply hydraulic connections. */
const EPSILON = 0.001;
const BRIDGE_RADIUS = 32;
const BRIDGE_CLEARANCE = BRIDGE_RADIUS + 3;
const QUARTER_CIRCLE = 0.55228475;

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const number = value => String(Math.round(value * 1000) / 1000);
const position = point => `${number(point.x)} ${number(point.y)}`;
const same = (a, b) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const offset = (point, vector, length) => ({ x: point.x + vector.x * length, y: point.y + vector.y * length });

function cleanPoints(points) {
  const result = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const copy = { x: point.x, y: point.y };
    if (result.length && same(result[result.length - 1], copy)) continue;
    while (result.length > 1) {
      const a = result[result.length - 2], b = result[result.length - 1];
      const first = { x: b.x - a.x, y: b.y - a.y }, second = { x: copy.x - b.x, y: copy.y - b.y };
      const straight = Math.abs(first.x * second.y - first.y * second.x) < EPSILON;
      const forward = first.x * second.x + first.y * second.y > 0;
      if (!straight || !forward) break;
      result.pop();
    }
    result.push(copy);
  }
  return result;
}

function direction(a, b) {
  const length = distance(a, b);
  return length ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 0, y: 0 };
}

function intersection(a, b, c, d) {
  const own = { x: b.x - a.x, y: b.y - a.y };
  const other = { x: d.x - c.x, y: d.y - c.y };
  const delta = { x: c.x - a.x, y: c.y - a.y };
  const cross = (first, second) => first.x * second.y - first.y * second.x;
  const determinant = cross(own, other);
  const ownLength = distance(a, b), otherLength = distance(c, d);
  // Relative tolerance avoids treating parallel or near-zero-length segments as intersections.
  if (!ownLength || !otherLength || Math.abs(determinant) <= ownLength * otherLength * 1e-10) return null;
  const ownPosition = cross(delta, other) / determinant;
  const otherPosition = cross(delta, own) / determinant;
  const clear = (position, length) => position * length >= BRIDGE_CLEARANCE && (1 - position) * length >= BRIDGE_CLEARANCE;
  if (!clear(ownPosition, ownLength) || !clear(otherPosition, otherLength)) return null;
  return { x: a.x + ownPosition * own.x, y: a.y + ownPosition * own.y };
}

function bridge(center, along) {
  // Choose a traversal-independent side: above mostly horizontal pipes, right of mostly vertical pipes.
  let normal = { x: -along.y, y: along.x };
  const flip = Math.abs(along.x) >= Math.abs(along.y) ? normal.y > 0 : normal.x < 0;
  if (flip) normal = { x: -normal.x, y: -normal.y };
  const start = offset(center, along, -BRIDGE_RADIUS);
  const end = offset(center, along, BRIDGE_RADIUS);
  const top = offset(center, normal, BRIDGE_RADIUS);
  const control = BRIDGE_RADIUS * QUARTER_CIRCLE;
  return `L${position(start)}C${position(offset(start, normal, control))} ${position(offset(top, along, -control))} ${position(top)}` +
    `C${position(offset(top, along, control))} ${position(offset(end, normal, control))} ${position(end)}`;
}

/**
 * Render a rounded SVG path, optionally jumping over other crossing polylines.
 * Crossing polylines are geometry only: endpoint connections and graph state belong to the caller.
 */
export function pipePath(points, crossingPolylines = []) {
  const clean = cleanPoints(points);
  if (!clean.length) return '';
  if (clean.length === 1) return `M${position(clean[0])}`;
  const otherSegments = [];
  for (const polyline of Array.isArray(crossingPolylines) ? crossingPolylines : []) {
    const other = cleanPoints(polyline);
    for (let index = 1; index < other.length; index++) otherSegments.push([other[index - 1], other[index]]);
  }
  const corners = clean.map((point, index) => {
    if (!index || index === clean.length - 1) return { before: point, after: point, radius: 0 };
    const previous = clean[index - 1], next = clean[index + 1];
    const incoming = direction(previous, point), outgoing = direction(point, next);
    if (Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) < EPSILON) {
      return { before: point, after: point, radius: 0 };
    }
    const radius = Math.min(11, distance(previous, point) / 2, distance(point, next) / 2);
    return { before: offset(point, incoming, -radius), after: offset(point, outgoing, radius), radius };
  });
  let path = `M${position(clean[0])}`;
  for (let index = 1; index < clean.length; index++) {
    const start = corners[index - 1].after, end = corners[index].before;
    const along = direction(start, end);
    const crossings = otherSegments.map(([a, b]) => intersection(start, end, a, b)).filter(Boolean)
      .sort((a, b) => distance(start, a) - distance(start, b));
    let last = null;
    for (const crossing of crossings) {
      if (last && distance(last, crossing) < BRIDGE_RADIUS * 2 + 4) continue;
      path += bridge(crossing, along);
      last = crossing;
    }
    path += `L${position(end)}`;
    if (corners[index].radius) path += `Q${position(clean[index])} ${position(corners[index].after)}`;
  }
  return path;
}
