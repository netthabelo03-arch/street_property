// Promote: paid boosts through the "promote" Edge Function (Paystack), and
// the QR code drawing used by the free ad tools.

import { getClient } from '../auth/client.js';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Call the promote Edge Function. Returns { waiting: true } until Paystack is set up. */
export async function promote(action, body = {}) {
  const client = await getClient();
  const { data, error } = await client.functions.invoke('promote', { body: { action, ...body } });
  if (error) {
    let code = 'promote_down';
    try {
      const answer = await error.context.json();
      if (answer?.error) code = answer.error;
    } catch {
      // keep the general problem
    }
    throw { hint: code };
  }
  return data;
}

/** The owner's boosts for one listing, newest first. */
export async function myBoosts(listingId) {
  const client = await getClient();
  return check(await client.from('listing_boosts').select('id, tier, amount_rands, days, state, starts_at, ends_at, paid_at, created_at')
    .eq('listing_id', listingId).order('created_at', { ascending: false }).limit(20));
}

// QR codes ---------------------------------------------------------------------------

const QR_JS = {
  src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  integrity: 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1',
};
let loading = null;

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QR_JS.src;
    script.integrity = QR_JS.integrity;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(window.qrcode);
    script.onerror = () => {
      loading = null;
      reject(new Error('The QR code could not load. Check your connection.'));
    };
    document.head.append(script);
  });
  return loading;
}

/** The dark squares of a QR code for the text: { size, dark(row, col) }. */
export async function qrMatrix(text) {
  const qrcode = await loadQr();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return { size, dark: (row, col) => qr.isDark(row, col) };
}

/** An SVG element of the QR code, with a 4-square quiet zone. */
export async function qrSvg(text, label = 'QR code') {
  const { size, dark } = await qrMatrix(text);
  const full = size + 8;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${full} ${full}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const back = document.createElementNS(ns, 'rect');
  back.setAttribute('width', String(full));
  back.setAttribute('height', String(full));
  back.setAttribute('fill', '#fff');
  svg.append(back);
  let d = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (dark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(path);
  return svg;
}

/** Draw the QR code on a canvas at (x, y), `width` pixels wide, on white. */
export async function drawQr(pen, text, x, y, width) {
  const { size, dark } = await qrMatrix(text);
  const cell = width / (size + 8);
  pen.fillStyle = '#fff';
  pen.fillRect(x, y, width, width);
  pen.fillStyle = '#000';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (dark(row, col)) pen.fillRect(Math.floor(x + (col + 4) * cell), Math.floor(y + (row + 4) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}
