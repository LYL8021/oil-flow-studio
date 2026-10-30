/* Reference dimensions use diagram units; image pixels and component sizes stay unchanged. */
const MAX_POSITION = 40000;
const MAX_SIZE = 30000;
const MAX_BASE_SIZE = 3000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validSize = (value, max) => Number.isFinite(value) && value >= 1 && value <= max;

/** Accept existing references and remember the dimensions represented by 100%. */
export function normalizeReference(value) {
  const r = value;
  if (!r || typeof r !== 'object' || typeof r.dataUrl !== 'string'
      || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.dataUrl)
      || r.dataUrl.length > 3.5e6
      || !validSize(r.width, MAX_SIZE) || !validSize(r.height, MAX_SIZE)) {
    throw new Error('圖片底圖資料無效或超過範圍');
  }

  let baseWidth = r.baseWidth, baseHeight = r.baseHeight;
  if (baseWidth == null && baseHeight == null) {
    // Older projects stored only their displayed dimensions. Larger references
    // without base metadata can still be read by inferring a proportional base.
    const factor = Math.min(1, MAX_BASE_SIZE / Math.max(r.width, r.height));
    baseWidth = r.width * factor;
    baseHeight = r.height * factor;
  }
  if (!validSize(baseWidth, MAX_BASE_SIZE) || !validSize(baseHeight, MAX_BASE_SIZE)) {
    throw new Error('圖片底圖的原始尺寸無效或超過範圍');
  }
  const ratioX = r.width / baseWidth, ratioY = r.height / baseHeight;
  if (Math.abs(ratioX - ratioY) > 1e-6 * Math.max(1, ratioX, ratioY)) {
    throw new Error('圖片底圖的原始尺寸與顯示比例不符');
  }
  return {
    dataUrl: r.dataUrl,
    width: r.width, height: r.height, baseWidth, baseHeight,
    x: Number.isFinite(r.x) ? clamp(r.x, -MAX_POSITION, MAX_POSITION) : 0,
    y: Number.isFinite(r.y) ? clamp(r.y, -MAX_POSITION, MAX_POSITION) : 0,
    visible: r.visible !== false,
    opacity: Number.isFinite(r.opacity) ? clamp(r.opacity, .05, .6) : .22
  };
}

/** Resize/move a reference, optionally spreading diagram positions with it. */
export function transformReference(project, options = {}) {
  if (!project?.reference) throw new Error('請先載入圖片底圖');
  const previous = normalizeReference(project.reference);
  const {scale, x = previous.x, y = previous.y, moveLayout = false} = options;
  if (!Number.isFinite(scale) || scale < 25 || scale > 1000) {
    throw new Error('底圖縮放比例須介於 25% 至 1000%');
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)
      || Math.abs(x) > MAX_POSITION || Math.abs(y) > MAX_POSITION) {
    throw new Error('底圖位置須介於 -40000 至 40000');
  }
  if (typeof moveLayout !== 'boolean') throw new Error('請選擇是否同步調整元件位置');
  const width = previous.baseWidth * scale / 100;
  const height = previous.baseHeight * scale / 100;
  if (!validSize(width, MAX_SIZE) || !validSize(height, MAX_SIZE)) {
    throw new Error('縮放後底圖尺寸超過範圍，請調整比例');
  }

  const next = typeof structuredClone === 'function'
    ? structuredClone(project) : JSON.parse(JSON.stringify(project));
  next.reference = {...next.reference, ...previous, width, height, x, y};
  if (!moveLayout) return next;
  if (!Array.isArray(next.nodes) || !Array.isArray(next.edges)) {
    throw new Error('圖面資料須包含元件與油管');
  }
  const factorX = width / previous.width, factorY = height / previous.height;
  const transformPosition = point => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error('元件或油管轉折點位置無效');
    }
    const nextX = x + (point.x - previous.x) * factorX;
    const nextY = y + (point.y - previous.y) * factorY;
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)
        || Math.abs(nextX) > MAX_POSITION || Math.abs(nextY) > MAX_POSITION) {
      throw new Error('同步調整後元件或油管超出位置範圍，請縮小比例或取消同步位置');
    }
    point.x = nextX;
    point.y = nextY;
  };
  next.nodes.forEach(transformPosition);
  for (const edge of next.edges) {
    if (edge.routing !== 'free' || edge.waypoints == null) continue;
    if (!Array.isArray(edge.waypoints)) throw new Error('油管轉折點資料無效');
    edge.waypoints.forEach(transformPosition);
  }
  return next;
}
