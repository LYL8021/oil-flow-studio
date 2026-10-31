/* Shared pipe endpoints stay seamless without changing crossing or bridge geometry. */
const visualNumber = value => String(Math.round(value * 1e9) / 1e9);

/**
 * A normalized dash pattern clips only the underlay near a shared pipe endpoint.
 * Use this value as stroke-dasharray on the ORIGINAL border path, with pathLength=1.
 * The coloured path and its bridge curves are unchanged. Equipment ends are not
 * joins: their border remains complete and their cap ends flat at the flange.
 */
export function pipeBorderDashes(points, {startJoin = false, endJoin = false, inset = 20} = {}) {
  if (typeof startJoin !== 'boolean' || typeof endJoin !== 'boolean'
      || !Number.isFinite(inset) || inset < 0) throw new Error('管線接合顯示設定無效');
  if (!startJoin && !endJoin || inset === 0) return null;
  if (!Array.isArray(points) || points.some(point => !point
      || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('管線接合座標無效');
  }
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  const beginning = startJoin ? inset : 0, ending = endJoin ? inset : 0;
  if (!(length > beginning + ending)) return '0 2';
  // A zero-length initial dash followed by the clipped prefix avoids an offset
  // sign dependency. The final gap exceeds the entire normalized path length.
  return `0 ${visualNumber(beginning / length)} ${visualNumber((length - beginning - ending) / length)} 2`;
}
