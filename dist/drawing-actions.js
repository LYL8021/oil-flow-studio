import {normalizeReference} from './reference-layout.js';

/* These actions change the working drawing only; saved library records live elsewhere. */
const cloneDrawingValue = value => typeof structuredClone === 'function'
  ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export function createBlankDrawing() {
  return {nodes:[], edges:[]};
}

/** Replace a background, explicitly retaining or discarding the working components. */
export function applyReference(project, reference, {keepComponents = true, title, draftInfo} = {}) {
  if (!project || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    throw new Error('目前圖面資料無效，無法套用底圖');
  }
  if (typeof keepComponents !== 'boolean') throw new Error('請選擇是否保留目前元件與油管');
  if (title !== undefined && (typeof title !== 'string' || Array.from(title).length > 80)) {
    throw new Error('新圖面名稱需為 80 個字以內');
  }
  if (draftInfo !== undefined && (!draftInfo || typeof draftInfo !== 'object' || Array.isArray(draftInfo))) {
    throw new Error('底圖說明資料無效');
  }
  // Validate before creating the result so invalid input never partially clears a drawing.
  const normalizedReference = normalizeReference(reference);
  const next = keepComponents ? cloneDrawingValue(project) : createBlankDrawing();
  next.reference = normalizedReference;
  if (title !== undefined && (!keepComponents || !next.title)) next.title = title;
  if (draftInfo !== undefined && (!keepComponents || !next.draftInfo)) next.draftInfo = cloneDrawingValue(draftInfo);
  return next;
}
