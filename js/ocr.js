// Korean + English OCR via tesseract.js (CDN global `Tesseract`).
// First call downloads ~10MB+ language data, so it can be slow.
export async function ocrImage(file, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const result = await Tesseract.recognize(url, 'kor+eng', {
      logger: m => { if (onProgress) onProgress(m); }
    });
    return result.data.text || '';
  } finally {
    URL.revokeObjectURL(url);
  }
}
