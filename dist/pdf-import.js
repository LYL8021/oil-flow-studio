/* PDF pages are rasterized locally. Embedded PDF scripts and attachments never run. */
let pdfLibraryPromise;
const PDF_MAX_BYTES = 15 * 1024 * 1024;
const PDF_REFERENCE_CHARS = 2 * 1024 * 1024;

export function isPdfFile(file) {
  return !!file && (String(file.type || '').toLowerCase() === 'application/pdf'
    || /\.pdf$/i.test(String(file.name || '')));
}

function pdfAbortError() {
  const error = new Error('已取消 PDF 圖面處理');error.name = 'AbortError';return error;
}
function pdfCheckAbort(signal) { if (signal?.aborted) throw pdfAbortError(); }
function pdfAbortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup();reject(pdfAbortError()); };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, {once:true});
    Promise.resolve(promise).then(value => {cleanup();resolve(value);}, error => {cleanup();reject(error);});
  });
}

/** Bounded page/rotation values are shared by the picker and reader. */
export function normalizePdfOptions({page = 1, rotation = 0} = {}) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('請選擇有效的 PDF 頁碼');
  if (!Number.isSafeInteger(rotation) || rotation % 90 !== 0) throw new Error('PDF 旋轉角度須為 90° 的倍數');
  return {page, rotation:((rotation % 360) + 360) % 360};
}

function pdfAssetFolder() {
  const configured = globalThis.OIL_PDF_BASE;
  return configured ? new URL(String(configured).replace(/\/?$/, '/'), globalThis.location?.href || import.meta.url)
    : new URL('./vendor/pdf/', import.meta.url);
}
async function loadPdfLibrary() {
  if (!pdfLibraryPromise) {
    const folder = pdfAssetFolder();
    pdfLibraryPromise = import(new URL('pdf.mjs', folder).href).then(library => {
      library.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', folder).href;
      return library;
    }).catch(error => {
      pdfLibraryPromise = null;
      throw new Error('無法載入 PDF 閱讀引擎，請確認網站資源完整後重試', {cause:error});
    });
  }
  return pdfLibraryPromise;
}

/** Read one selected page. Only its raster is kept in project JSON, never the PDF. */
export async function readPdf(file, {page = 1, rotation = 0, signal, onProgress} = {}) {
  pdfCheckAbort(signal);
  if (!isPdfFile(file) || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size)) {
    throw new Error('請選擇 PDF 圖面');
  }
  if (!file.size) throw new Error('PDF 檔案是空的');
  if (file.size > PDF_MAX_BYTES) throw new Error('PDF 超過 15 MB，請先縮小或另存需要的頁面');
  const options = normalizePdfOptions({page, rotation});
  if (typeof document === 'undefined') throw new Error('PDF 功能需要在瀏覽器中開啟');
  if (globalThis.location?.protocol === 'file:') throw new Error('PDF 匯入請使用線上版；可匯出含底圖的 JSON，再到離線版繼續編修');
  const report = (progress, message) => {
    try {onProgress?.({progress, message, status:'reading pdf'});} catch {}
  };
  let loadingTask, rendering, pdfPage;
  const abort = () => {rendering?.cancel();if (loadingTask) void loadingTask.destroy().catch(() => {});};
  signal?.addEventListener('abort', abort, {once:true});
  try {
    report(.01, '讀取 PDF 圖面…');
    const bytes = new Uint8Array(await pdfAbortable(file.arrayBuffer(), signal));
    pdfCheckAbort(signal);
    if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
      throw new Error('這個檔案不是可讀取的 PDF 圖面');
    }
    const library = await pdfAbortable(loadPdfLibrary(), signal);pdfCheckAbort(signal);
    const folder = pdfAssetFolder();
    loadingTask = library.getDocument({data:bytes, isEvalSupported:false,
      cMapUrl:new URL('cmaps/', folder).href, cMapPacked:true,
      standardFontDataUrl:new URL('standard_fonts/', folder).href,
      wasmUrl:new URL('wasm/', folder).href,
      useSystemFonts:true, enableXfa:false});
    const pdf = await pdfAbortable(loadingTask.promise, signal);pdfCheckAbort(signal);
    if (options.page > pdf.numPages) throw new Error(`這份 PDF 共有 ${pdf.numPages} 頁，請重新選擇頁碼`);
    report(.04, `轉換 PDF 第 ${options.page}／${pdf.numPages} 頁…`);
    pdfPage = await pdfAbortable(pdf.getPage(options.page), signal);pdfCheckAbort(signal);
    const totalRotation = ((pdfPage.rotate || 0) + options.rotation) % 360;
    const natural = pdfPage.getViewport({scale:1, rotation:totalRotation});
    if (!(natural.width > 0) || !(natural.height > 0) || !Number.isFinite(natural.width * natural.height)) {
      throw new Error('PDF 頁面尺寸無效，請另存 PDF 後重試');
    }
    const scale = Math.min(3, 3000 / natural.width, 3000 / natural.height,
      Math.sqrt(6000000 / (natural.width * natural.height)));
    const viewport = pdfPage.getViewport({scale, rotation:totalRotation});
    const canvas = document.createElement('canvas');canvas.width = Math.max(1, Math.floor(viewport.width));canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', {willReadFrequently:true});
    if (!context) throw new Error('目前瀏覽器無法建立 PDF 圖面畫布');
    rendering = pdfPage.render({canvasContext:context, viewport, background:'rgb(255,255,255)', intent:'display'});
    await pdfAbortable(rendering.promise, signal);pdfCheckAbort(signal);
    report(.09, '整理 PDF 底圖…');
    let dataUrl;
    for (const quality of [.88, .75, .60, .45]) {
      dataUrl = canvas.toDataURL('image/webp', quality);
      if (dataUrl.length <= PDF_REFERENCE_CHARS) break;
    }
    if (dataUrl.length > PDF_REFERENCE_CHARS) dataUrl = canvas.toDataURL('image/jpeg', .45);
    if (dataUrl.length > PDF_REFERENCE_CHARS) throw new Error('這頁 PDF 圖面過於複雜，請先縮小或另存圖片後匯入');
    return {reference:{dataUrl, width:canvas.width, height:canvas.height, visible:true, opacity:.22},
      imageWidth:canvas.width, imageHeight:canvas.height, canvas,
      pdf:{page:options.page, pageCount:pdf.numPages, rotation:options.rotation}};
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'RenderingCancelledException') throw pdfAbortError();
    if (error?.name === 'PasswordException') throw new Error('這份 PDF 需要密碼，請先解除密碼再上傳');
    if (error?.name === 'InvalidPDFException' || error?.name === 'MissingPDFException') throw new Error('無法讀取這份 PDF，請確認檔案完整或另存 PDF 後重試');
    if (error instanceof Error && /[\u3400-\u9fff]/.test(error.message)) throw error;
    throw new Error('PDF 圖面轉換失敗，請另存 PDF 或圖片後再試', {cause:error});
  } finally {
    signal?.removeEventListener('abort', abort);pdfPage?.cleanup();
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}
