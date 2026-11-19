// Shrinks a photo on the phone before it is uploaded: the long side at most
// 1600 pixels, saved as JPEG. A 5 MB camera photo becomes about 300 KB, which
// saves the owner's data and the app's storage.

import { fitWithin } from '../listings/rules.js';

const MAX_BYTES = 2 * 1024 * 1024; // the listing-photos bucket's limit

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to the slower way (older Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not save the photo'))), 'image/jpeg', quality);
  });
}

/**
 * @param {File} file a photo the person picked
 * @param {{ max?: number, maxBytes?: number }} options long side in pixels and largest file
 *   (documents keep more detail than listing photos, so small print stays readable)
 * @returns {Promise<Blob>} a JPEG small enough to upload
 * @throws {{ code: 'not_a_photo' }} when the file is not a photo the browser can open
 */
export async function shrinkPhoto(file, { max = 1600, maxBytes = MAX_BYTES } = {}) {
  if (!String(file.type).startsWith('image/')) throw { code: 'not_a_photo' };
  let picture;
  try {
    picture = await decode(file);
  } catch {
    throw { code: 'not_a_photo' };
  }
  const width = picture.width || picture.naturalWidth;
  const height = picture.height || picture.naturalHeight;
  const size = fitWithin(width, height, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d').drawImage(picture, 0, 0, size.width, size.height);
  if (typeof picture.close === 'function') picture.close();
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= maxBytes) return blob;
  }
  throw { code: 'photo_too_big' };
}

/**
 * Shrink a photo and burn a line of text (place, room, time) into its bottom
 * edge, so the photo carries when it was taken wherever it is shown.
 * @returns {Promise<Blob>} a JPEG
 */
export async function stampPhoto(file, text, { max = 1600, maxBytes = MAX_BYTES } = {}) {
  if (!String(file.type).startsWith('image/')) throw { code: 'not_a_photo' };
  let picture;
  try {
    picture = await decode(file);
  } catch {
    throw { code: 'not_a_photo' };
  }
  const size = fitWithin(picture.width || picture.naturalWidth, picture.height || picture.naturalHeight, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const pen = canvas.getContext('2d');
  pen.drawImage(picture, 0, 0, size.width, size.height);
  if (typeof picture.close === 'function') picture.close();
  const fontSize = Math.max(14, Math.round(size.width / 40));
  const band = Math.round(fontSize * 2);
  pen.fillStyle = 'rgba(0, 0, 0, 0.55)';
  pen.fillRect(0, size.height - band, size.width, band);
  pen.fillStyle = '#ffffff';
  pen.font = `600 ${fontSize}px system-ui, sans-serif`;
  pen.textBaseline = 'middle';
  pen.fillText(text, Math.round(fontSize * 0.7), size.height - band / 2, size.width - fontSize * 1.4);
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= maxBytes) return blob;
  }
  throw { code: 'photo_too_big' };
}
