// Demo only: drawn sample "rooms" for photos, the simulated camera and the
// sample clips. Clearly labelled as samples; no real photos of anyone's home.

import { pickVideoType } from '../src/listings/rules.js';

const PALETTES = {
  outside: { wall: '#C9B79C', floor: '#5B5F63', accent: '#2F6F5E' },
  lounge: { wall: '#D8CFC0', floor: '#8A6A4F', accent: '#3E6E8C' },
  kitchen: { wall: '#E4E0D6', floor: '#9C9488', accent: '#B0563B' },
  bedroom: { wall: '#CFD6D9', floor: '#7D6450', accent: '#6C5A8C' },
  bathroom: { wall: '#DCE6E6', floor: '#A7B2B4', accent: '#3F8C8C' },
  meters: { wall: '#BFC4BC', floor: '#6E6E6E', accent: '#C9A227' },
  other: { wall: '#D3D0C8', floor: '#7A746B', accent: '#557A66' },
};

/** Which picture to draw for a room id or name. */
export function sceneFor(room) {
  const text = String(room ?? '').toLowerCase();
  if (text.startsWith('outside')) return 'outside';
  if (text.startsWith('lounge')) return 'lounge';
  if (text.startsWith('kitchen')) return 'kitchen';
  if (text.startsWith('bedroom') || text === 'the room') return 'bedroom';
  if (text.startsWith('bathroom')) return 'bathroom';
  if (text.startsWith('meters')) return 'meters';
  return 'other';
}

/**
 * Draw a simple room. `pan` (0 to 1) slides the view, as if the phone turns.
 */
export function paintRoom(ctx, width, height, scene, label, pan = 0) {
  const p = PALETTES[scene] ?? PALETTES.other;
  const shift = Math.round((pan - 0.5) * width * 0.25);
  ctx.save();
  if (scene === 'outside') {
    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.6);
    sky.addColorStop(0, '#8EC5E8');
    sky.addColorStop(1, '#D9EEF7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = p.floor; // street
    ctx.fillRect(0, height * 0.78, width, height * 0.22);
    ctx.fillStyle = '#F2B544';
    for (let x = -width; x < width * 2; x += width * 0.18) ctx.fillRect(x + shift * 1.4, height * 0.885, width * 0.09, height * 0.012);
    const hx = width * 0.22 + shift;
    ctx.fillStyle = p.wall; // house
    ctx.fillRect(hx, height * 0.42, width * 0.56, height * 0.3);
    ctx.fillStyle = '#7A3B2E';
    ctx.beginPath();
    ctx.moveTo(hx - width * 0.04, height * 0.43);
    ctx.lineTo(hx + width * 0.28, height * 0.26);
    ctx.lineTo(hx + width * 0.6, height * 0.43);
    ctx.fill();
    ctx.fillStyle = '#5A4232';
    ctx.fillRect(hx + width * 0.23, height * 0.56, width * 0.1, height * 0.16);
    ctx.fillStyle = '#9FD3EA';
    ctx.fillRect(hx + width * 0.06, height * 0.5, width * 0.11, height * 0.08);
    ctx.fillRect(hx + width * 0.39, height * 0.5, width * 0.11, height * 0.08);
    ctx.strokeStyle = '#2B2F33'; // gate
    ctx.lineWidth = Math.max(2, width * 0.008);
    for (let x = 0; x < width; x += width * 0.045) {
      ctx.beginPath();
      ctx.moveTo(x + shift * 1.6, height * 0.62);
      ctx.lineTo(x + shift * 1.6, height * 0.78);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, height * 0.64);
    ctx.lineTo(width, height * 0.64);
    ctx.stroke();
  } else {
    ctx.fillStyle = p.wall;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = p.floor;
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, height * 0.69, width, height * 0.02);
    // a window
    const wx = width * 0.55 + shift;
    ctx.fillStyle = '#F4F1EA';
    ctx.fillRect(wx - 6, height * 0.16 - 6, width * 0.3 + 12, height * 0.26 + 12);
    ctx.fillStyle = '#A9D8EE';
    ctx.fillRect(wx, height * 0.16, width * 0.3, height * 0.26);
    ctx.fillStyle = '#F4F1EA';
    ctx.fillRect(wx + width * 0.15 - 3, height * 0.16, 6, height * 0.26);
    ctx.fillStyle = p.accent;
    const fx = width * 0.1 + shift * 1.3;
    if (scene === 'lounge') { // sofa
      ctx.fillRect(fx, height * 0.52, width * 0.42, height * 0.16);
      ctx.fillRect(fx, height * 0.44, width * 0.42, height * 0.1);
    } else if (scene === 'kitchen') { // counter and stove
      ctx.fillStyle = '#F4F1EA';
      ctx.fillRect(0, height * 0.5, width, height * 0.2);
      ctx.fillStyle = p.accent;
      ctx.fillRect(fx, height * 0.18, width * 0.3, height * 0.18);
      ctx.fillStyle = '#2B2F33';
      ctx.fillRect(fx + width * 0.05, height * 0.5, width * 0.22, height * 0.04);
    } else if (scene === 'bedroom') { // bed
      ctx.fillStyle = '#F4F1EA';
      ctx.fillRect(fx, height * 0.5, width * 0.5, height * 0.2);
      ctx.fillStyle = p.accent;
      ctx.fillRect(fx, height * 0.56, width * 0.5, height * 0.14);
      ctx.fillStyle = '#7D6450';
      ctx.fillRect(fx - width * 0.02, height * 0.4, width * 0.04, height * 0.3);
    } else if (scene === 'bathroom') { // tiles and bath
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      for (let x = 0; x < width; x += width / 12) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height * 0.7); ctx.stroke(); }
      for (let y = 0; y < height * 0.7; y += width / 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(fx, height * 0.52, width * 0.48, height * 0.16);
    } else if (scene === 'meters') { // prepaid meter
      ctx.fillStyle = '#EDEBE4';
      ctx.fillRect(width * 0.3 + shift, height * 0.25, width * 0.4, height * 0.3);
      ctx.fillStyle = '#1F3A2E';
      ctx.fillRect(width * 0.35 + shift, height * 0.3, width * 0.3, height * 0.08);
      ctx.fillStyle = '#7FD1BC';
      ctx.font = `700 ${Math.round(width * 0.05)}px monospace`;
      ctx.textBaseline = 'middle';
      ctx.fillText('124.6 kWh', width * 0.37 + shift, height * 0.34);
    } else {
      ctx.fillRect(fx, height * 0.5, width * 0.3, height * 0.18);
    }
  }
  // label
  const size = Math.round(width * 0.045);
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  const text = `Sample · ${label}`;
  const textWidth = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(22,25,29,0.75)';
  ctx.fillRect(size * 0.6, height - size * 2.4, textWidth + size, size * 1.7);
  ctx.fillStyle = '#F2F0EA';
  ctx.fillText(text, size * 1.1, height - size * 0.95);
  ctx.restore();
}

/** A sample photo as a JPEG blob. */
export function samplePhoto(scene, label, pan = 0.5) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 900;
  paintRoom(canvas.getContext('2d'), canvas.width, canvas.height, scene, label, pan);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

function stampText(code, when) {
  const time = when.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${code}  ·  ${time}`;
}

/** The code badge, drawn the same way the real recorder draws it. */
export function drawStamp(ctx, width, code, when) {
  const fontSize = Math.round(width / 22);
  const text = stampText(code, when);
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  const pad = Math.round(fontSize * 0.5);
  const boxWidth = ctx.measureText(text).width + pad * 2;
  const x = width - boxWidth - pad;
  ctx.fillStyle = 'rgba(15, 46, 40, 0.85)';
  ctx.fillRect(x, pad, boxWidth, fontSize + pad * 2);
  ctx.fillStyle = '#F2B544';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + pad, pad * 2);
}

/**
 * A short sample clip of a room, with the day's code burned in, like a real
 * one. Resolves to { blob, url } or null when this browser cannot record.
 */
export function sampleClip(scene, label, code, when, seconds = 3) {
  const type = typeof MediaRecorder === 'undefined' ? null : pickVideoType((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  const started = performance.now();
  const frame = () => {
    const t = Math.min(1, (performance.now() - started) / (seconds * 1000));
    paintRoom(ctx, canvas.width, canvas.height, scene, label, t);
    drawStamp(ctx, canvas.width, code, when);
  };
  frame();
  const timer = setInterval(frame, 1000 / 24);
  const stream = canvas.captureStream(24);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 600000 });
  const pieces = [];
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size) pieces.push(event.data); });
  return new Promise((resolve) => {
    recorder.addEventListener('stop', () => {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      if (!pieces.length) { resolve(null); return; }
      const blob = new Blob(pieces, { type: type.split(';')[0] });
      resolve({ blob, url: URL.createObjectURL(blob) });
    });
    recorder.start(500);
    setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), seconds * 1000);
  });
}

/**
 * The simulated camera: a drawn room that slowly turns, named after the room
 * picked on the filming screen.
 */
export function fakeCameraStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  const started = performance.now();
  const draw = () => {
    const name = document.querySelector('.room--now .room__name')?.textContent ?? 'Lounge';
    const t = ((performance.now() - started) / 8000) % 1;
    const pan = t < 0.5 ? t * 2 : 2 - t * 2;
    paintRoom(ctx, canvas.width, canvas.height, sceneFor(name), `${name} (simulated camera)`, pan);
  };
  draw();
  const timer = setInterval(draw, 1000 / 30);
  const stream = canvas.captureStream(30);
  stream.demoStop = () => clearInterval(timer);
  return stream;
}
