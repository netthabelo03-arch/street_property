// DEMO COPY of src/media/recorder.js: the camera and location are simulated.
// Everything else (the code burned into the corner, the recording) is the real code.
//
// Films one room of the video tour. The camera picture is drawn onto a canvas
// with today's code and the time in the corner, and the canvas is recorded, so
// the code is part of the video itself. No sound is recorded.

import { pickVideoType, TOUR } from '../src/listings/rules.js';
import { fakeCameraStream } from './media.js';

const BITS_PER_SECOND = 1200000; // about 4.5 MB for a 30-second clip

/** Whether this browser can film a tour at all. */
export function canFilm() {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && pickVideoType((type) => MediaRecorder.isTypeSupported(type)) !== null;
}

/** Demo: a drawn room instead of the back camera. */
export async function openCamera() {
  return fakeCameraStream();
}

export function stopCamera(stream) {
  stream?.demoStop?.();
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

/**
 * Where the phone is now.
 * @returns {Promise<{ lat: number, lng: number, accuracy: number }>}
 * @throws {{ code: 'location_denied' | 'location_unavailable' }}
 */
export function currentPosition() {
  // Demo: standing outside 24 Ngakane Street, Orlando West, give or take a few metres.
  return Promise.resolve({ lat: -26.2385 + (Math.random() - 0.5) * 0.00008, lng: 27.9086 + (Math.random() - 0.5) * 0.00008, accuracy: 6 + Math.round(Math.random() * 6) });
}

function stamp(code) {
  const time = new Date().toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${code}  ·  ${time}`;
}

/**
 * Start recording. The caller shows the camera in `video`.
 * @param {{ video: HTMLVideoElement, code: string, maxSeconds?: number, onTick?: (seconds: number) => void }} options
 * @returns {{ stop: () => void, done: Promise<{ blob: Blob, seconds: number, type: string }> }}
 */
export function startRecording({ video, code, maxSeconds = TOUR.clipMaxSeconds, onTick = () => {} }) {
  const type = pickVideoType((choice) => MediaRecorder.isTypeSupported(choice));
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  const fontSize = Math.round(canvas.width / 22);

  let running = true;
  let drawn = 0;
  function draw() {
    if (!running) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const text = stamp(code);
    context.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    const pad = Math.round(fontSize * 0.5);
    const width = context.measureText(text).width + pad * 2;
    const x = canvas.width - width - pad;
    const y = pad;
    context.fillStyle = 'rgba(15, 46, 40, 0.85)';
    context.fillRect(x, y, width, fontSize + pad * 2);
    context.fillStyle = '#F2B544';
    context.textBaseline = 'top';
    context.fillText(text, x + pad, y + pad);
    drawn += 1;
    requestAnimationFrame(draw);
  }
  draw();

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITS_PER_SECOND });
  const pieces = [];
  const started = performance.now();
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) pieces.push(event.data);
  });

  const ticker = setInterval(() => {
    const seconds = (performance.now() - started) / 1000;
    onTick(seconds);
    if (seconds >= maxSeconds) stop();
  }, 250);

  const done = new Promise((resolve, reject) => {
    recorder.addEventListener('stop', () => {
      const seconds = Math.min((performance.now() - started) / 1000, maxSeconds);
      running = false;
      clearInterval(ticker);
      for (const track of stream.getTracks()) track.stop();
      if (pieces.length === 0 || drawn === 0) {
        reject({ code: 'nothing_recorded' });
        return;
      }
      resolve({ blob: new Blob(pieces, { type: type.split(';')[0] }), seconds, type });
    });
    recorder.addEventListener('error', () => {
      running = false;
      clearInterval(ticker);
      reject({ code: 'recording_failed' });
    });
  });

  function stop() {
    if (recorder.state !== 'inactive') recorder.stop();
  }

  recorder.start(1000);
  return { stop, done };
}
