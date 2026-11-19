// The full-screen tour: the clips play one after another like a walk through
// the place. A bar per room at the top shows where you are; tap the right side
// for the next room, the left side for the one before.

import { el } from '../dom.js';

/**
 * @param {{ clips: { url: string, room: string, seconds: number }[], roomName: (id: string) => string, title: string, start?: number }} options
 */
export function openTour({ clips, roomName, title, start = 0 }) {
  const playable = clips.filter((clip) => clip.url);
  if (playable.length === 0) return;
  const before = document.activeElement;
  let index = Math.min(Math.max(start, 0), playable.length - 1);
  let finished = false;

  const video = el('video', { class: 'tour-full__video', playsinline: '', muted: '', autoplay: '', preload: 'auto' });
  video.muted = true;
  const bars = playable.map(() => el('span', { class: 'tour-full__bar' }, [el('span', { class: 'tour-full__fill' })]));
  const room = el('p', { class: 'tour-full__room', 'aria-live': 'polite' });
  const close = el('button', { type: 'button', class: 'tour-full__close', 'aria-label': 'Close the tour', text: '✕' });
  const pause = el('button', { type: 'button', class: 'tour-full__pause', 'aria-label': 'Pause', text: 'Ⅱ' });
  const back = el('button', { type: 'button', class: 'tour-full__zone tour-full__zone--back', 'aria-label': 'Room before' });
  const next = el('button', { type: 'button', class: 'tour-full__zone tour-full__zone--next', 'aria-label': 'Next room' });
  const end = el('div', { class: 'tour-full__end' });
  end.hidden = true;

  const overlay = el('div', { class: 'tour-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Video tour: ${title}` }, [
    video,
    back,
    next,
    el('div', { class: 'tour-full__top' }, [
      el('div', { class: 'tour-full__bars' }, bars),
      el('div', { class: 'tour-full__heading' }, [
        el('div', {}, [room, el('p', { class: 'tour-full__title', text: title })]),
        close,
      ]),
    ]),
    pause,
    end,
  ]);

  function drawBars() {
    bars.forEach((bar, n) => {
      const fill = bar.firstElementChild;
      if (n < index) fill.style.width = '100%';
      else if (n > index) fill.style.width = '0%';
      else fill.style.width = video.duration ? `${Math.min(100, (video.currentTime / video.duration) * 100)}%` : '0%';
    });
  }

  function show(n) {
    index = n;
    finished = false;
    end.hidden = true;
    const clip = playable[index];
    room.textContent = `${roomName(clip.room)} · ${index + 1} of ${playable.length}`;
    delete video.dataset.held;
    video.src = clip.url;
    video.play().catch(() => {});
    pause.textContent = 'Ⅱ';
    pause.setAttribute('aria-label', 'Pause');
    drawBars();
  }

  function finish() {
    finished = true;
    video.dataset.held = 'yes';
    drawBars();
    const again = el('button', { type: 'button', class: 'button button--primary', text: 'Watch again' });
    again.addEventListener('click', () => show(0));
    const done = el('button', { type: 'button', class: 'button button--quiet', text: 'Close' });
    done.addEventListener('click', shut);
    end.replaceChildren(el('p', { class: 'tour-full__end-title', text: 'That was the whole tour' }), again, done);
    end.hidden = false;
    again.focus();
  }

  function forward() {
    if (index + 1 < playable.length) show(index + 1);
    else finish();
  }
  function backward() {
    if (video.currentTime > 2 || index === 0) {
      video.currentTime = 0;
      video.play().catch(() => {});
    } else show(index - 1);
  }

  video.addEventListener('timeupdate', drawBars);
  // Some phones ignore play() while a clip is still loading: try again once it can play.
  video.addEventListener('canplay', () => {
    if (video.paused && !video.dataset.held) video.play().catch(() => {});
  });
  video.addEventListener('ended', forward);
  next.addEventListener('click', forward);
  back.addEventListener('click', backward);
  pause.addEventListener('click', () => {
    if (finished) return;
    if (video.paused) {
      delete video.dataset.held;
      video.play().catch(() => {});
      pause.textContent = 'Ⅱ';
      pause.setAttribute('aria-label', 'Pause');
    } else {
      video.dataset.held = 'yes';
      video.pause();
      pause.textContent = '▶';
      pause.setAttribute('aria-label', 'Play');
    }
  });

  function onKey(event) {
    if (event.key === 'Escape') shut();
    else if (event.key === 'ArrowRight') forward();
    else if (event.key === 'ArrowLeft') backward();
  }
  function shut() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    overlay.remove();
    document.body.classList.remove('tour-open');
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', shut);
    before?.focus?.();
  }
  close.addEventListener('click', shut);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', shut);

  document.body.classList.add('tour-open');
  document.body.append(overlay);
  close.focus();
  show(index);
}
