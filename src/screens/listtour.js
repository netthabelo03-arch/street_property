// Step 2: film the video tour, one short clip per room, at the place.
// Every clip shows today's code in its corner and saves where it was filmed,
// so the reviewer can tell the tour is real and recent.

import { loadViewer } from '../viewer.js';
import { canList } from '../roles.js';
import { getListing, listClips, todaysCode, addClip, removeClip } from '../listings/api.js';
import { TOUR, tourRooms, formatSeconds, secondsLeft, isEditable, STATUSES, videoExtension } from '../listings/rules.js';
import { friendlyListingError, cameraProblem } from '../listings/errors.js';
import { canFilm, openCamera, stopCamera, currentPosition, startRecording } from '../media/recorder.js';
import { topBar, tabBar } from '../shell.js';
import { el, messageBox, whileBusy } from '../dom.js';
import { stepHeader, notFound, notALister } from './listing-parts.js';

const MAX_CLIP_BYTES = 12 * 1024 * 1024;

export async function renderListTour({ session, route }) {
  const { profile } = await loadViewer(session);
  const bar = topBar({ profile, session });
  if (!canList(profile?.role)) return notALister(bar, tabBar('profile'));

  const listing = await getListing(route.id);
  if (!listing || listing.owner_id !== session.user.id) return notFound(bar, tabBar('profile'));
  const header = stepHeader(listing.id, 'tour');
  if (!isEditable(listing.status)) {
    return [
      bar, header,
      el('h1', { class: 'title', text: 'This listing is locked' }),
      el('p', { class: 'lead', text: `${STATUSES[listing.status].about} To film again, stop the review or take it down first.` }),
      el('a', { href: `#/list/${listing.id}/send`, class: 'button button--primary', text: 'Open the listing' }),
      tabBar('profile'),
    ];
  }

  let clips = await listClips(listing.id);
  const rooms = tourRooms(listing);
  // Clips for rooms no longer on the list (fewer bedrooms now) still count.
  for (const clip of clips) {
    if (!rooms.some((room) => room.id === clip.room)) rooms.push({ id: clip.room, name: clip.room.replace('_', ' '), hint: 'Filmed earlier' });
  }
  const code = await todaysCode(listing.id);
  const message = messageBox();

  const intro = el('p', { class: 'lead', text: 'Walk through the place with your phone upright, one short clip per room. Renters see it all before they travel to a viewing.' });

  if (!canFilm()) {
    return [
      bar, header,
      el('h1', { class: 'title', text: 'Film your video tour' }),
      intro,
      el('p', { class: 'message message--error', text: 'This browser cannot film the tour. On your phone, open the app in Chrome (Android) or Safari (iPhone), at the place you are listing.' }),
      el('a', { href: `#/list/${listing.id}/send`, class: 'button button--quiet', text: 'Skip for now' }),
      tabBar('profile'),
    ];
  }

  // Camera
  const video = el('video', { class: 'camera__video', playsinline: '', muted: '', autoplay: '' });
  video.muted = true;
  const recLabel = el('span', { class: 'camera__rec', text: 'Camera off' });
  const codeBadge = el('span', { class: 'camera__code', text: code });
  const startCamera = el('button', { type: 'button', class: 'button button--primary camera__start', text: 'Start camera' });
  const camera = el('div', { class: 'camera' }, [video, recLabel, codeBadge, startCamera]);
  const where = el('p', { class: 'at-address' }, [
    el('span', { class: 'at-address__title', text: 'At the address' }),
    el('span', { text: ` Today's code shows in the corner of every clip: ${code}` }),
  ]);
  const whereStatus = el('p', { class: 'field__hint', text: 'Your location is checked when you start the camera.' });

  let stream = null;
  let position = null;
  let recording = null;
  let current = rooms.find((room) => !clips.some((clip) => clip.room === room.id))?.id ?? rooms[0].id;
  let openRoom = null;

  function closeCamera() {
    if (recording) recording.stop();
    stopCamera(stream);
    stream = null;
  }
  // Leaving the screen, or the phone locking, switches the camera off.
  const leave = () => {
    closeCamera();
    window.removeEventListener('hashchange', leave);
    document.removeEventListener('visibilitychange', hidden);
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') {
      closeCamera();
      video.srcObject = null;
      startCamera.hidden = false;
      recLabel.textContent = 'Camera off';
      draw();
    }
  };
  window.addEventListener('hashchange', leave);
  document.addEventListener('visibilitychange', hidden);

  async function locate() {
    whereStatus.textContent = 'Finding your location…';
    position = await currentPosition();
    whereStatus.textContent = `Location found (within about ${Math.round(position.accuracy)} m).`;
  }

  startCamera.addEventListener('click', () => whileBusy(startCamera, 'Starting…', async () => {
    message.clear();
    try {
      await locate();
    } catch (error) {
      whereStatus.textContent = 'Location not found yet.';
      message.show(friendlyListingError(error));
      return;
    }
    try {
      stream = await openCamera();
    } catch (error) {
      message.show(friendlyListingError(cameraProblem(error)));
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    startCamera.hidden = true;
    draw();
  }));

  // Rooms
  const roomList = el('ul', { class: 'rooms' });
  const progress = el('p', { class: 'tour-progress' });
  const record = el('button', { type: 'button', class: 'button button--primary' });

  function draw() {
    const used = clips.reduce((sum, clip) => sum + Number(clip.seconds), 0);
    roomList.replaceChildren(...rooms.map((room) => {
      const clip = clips.find((item) => item.room === room.id);
      const isNow = room.id === current;
      const time = clip ? formatSeconds(clip.seconds) : isNow ? 'Next' : room.required ? 'Needed' : '';
      const pick = el('button', { type: 'button', class: `room${isNow ? ' room--now' : ''}`, 'aria-pressed': String(isNow) }, [
        el('span', { class: `room__dot${clip ? ' room__dot--done' : ''}`, 'aria-hidden': 'true', text: clip ? '✓' : '' }),
        el('span', { class: 'room__text' }, [
          el('span', { class: 'room__name', text: room.name }),
          el('span', { class: 'room__hint', text: room.hint }),
        ]),
        el('span', { class: `room__time${clip ? ' room__time--done' : ''}`, text: time }),
      ]);
      pick.addEventListener('click', () => {
        if (recording) return;
        current = room.id;
        openRoom = clip && openRoom !== room.id ? room.id : null;
        draw();
      });
      const parts = [pick];
      if (clip && openRoom === room.id) {
        const player = el('video', { class: 'room__player', controls: '', playsinline: '', preload: 'metadata' });
        if (clip.url) player.src = clip.url;
        const remove = el('button', { type: 'button', class: 'button button--quiet button--small', text: 'Remove clip' });
        remove.addEventListener('click', () => whileBusy(remove, 'Removing…', async () => {
          message.clear();
          try {
            await removeClip(clip);
            clips = clips.filter((item) => item !== clip);
            openRoom = null;
            draw();
          } catch (error) {
            message.show(friendlyListingError(error));
          }
        }));
        parts.push(el('div', { class: 'room__open' }, [player, el('p', { class: 'field__hint', text: 'To film this room again, press Record below.' }), remove]));
      }
      return el('li', {}, parts);
    }));
    progress.textContent = `${clips.length} of ${rooms.length} rooms · ${formatSeconds(used)} of ${formatSeconds(TOUR.totalMaxSeconds)}`;
    const room = rooms.find((item) => item.id === current);
    const again = clips.some((clip) => clip.room === current);
    if (recording) return;
    recLabel.textContent = stream ? `Ready: ${room.name}` : 'Camera off';
    record.disabled = !stream || secondsLeft(clips, current) < 1;
    record.textContent = !stream ? 'Start the camera to record'
      : secondsLeft(clips, current) < 1 ? 'The tour is full (2:00)'
        : `${again ? 'Film again' : 'Record'}: ${room.name.toLowerCase()}`;
  }
  draw();

  record.addEventListener('click', async () => {
    if (recording) {
      recording.stop();
      return;
    }
    message.clear();
    const room = rooms.find((item) => item.id === current);
    try {
      position = await currentPosition();
    } catch (error) {
      message.show(friendlyListingError(error));
      return;
    }
    const limit = Math.min(TOUR.clipMaxSeconds, secondsLeft(clips, current));
    recording = startRecording({
      video,
      code,
      maxSeconds: limit,
      onTick: (seconds) => {
        record.textContent = `Stop · ${formatSeconds(seconds)} of ${formatSeconds(limit)}`;
      },
    });
    recLabel.textContent = `● Recording: ${room.name}`;
    recLabel.classList.add('camera__rec--on');
    record.textContent = 'Stop';
    let result;
    try {
      result = await recording.done;
    } catch (error) {
      message.show(friendlyListingError(error));
    }
    recording = null;
    recLabel.classList.remove('camera__rec--on');
    recLabel.textContent = stream ? `Ready: ${room.name}` : 'Camera off';
    if (!result) {
      draw();
      return;
    }
    if (result.seconds < 1.5) {
      message.show(friendlyListingError({ code: 'nothing_recorded' }));
      draw();
      return;
    }
    if (result.blob.size > MAX_CLIP_BYTES) {
      message.show(friendlyListingError({ code: 'clip_too_big' }));
      draw();
      return;
    }
    record.disabled = true;
    record.textContent = 'Saving clip…';
    try {
      await addClip({
        userId: session.user.id,
        listingId: listing.id,
        room: room.id,
        blob: result.blob,
        type: result.type,
        extension: videoExtension(result.type),
        seconds: Math.min(result.seconds, TOUR.clipMaxSeconds),
        position,
      });
      clips = await listClips(listing.id);
      current = rooms.find((item) => !clips.some((clip) => clip.room === item.id))?.id ?? current;
      message.show(`Saved: ${room.name}.`, 'success');
    } catch (error) {
      message.show(friendlyListingError(error));
    }
    record.disabled = false;
    draw();
  });

  return [
    bar,
    header,
    el('h1', { class: 'title', text: 'Film your video tour' }),
    intro,
    camera,
    where,
    whereStatus,
    roomList,
    el('p', { class: 'note', text: 'Tips: open curtains and switch lights on, keep people out of the shot, and film the meter and the view from the gate. Up to 30 seconds a room and 2 minutes in all. Sound is not recorded.' }),
    progress,
    message.node,
    record,
    el('a', { href: `#/list/${listing.id}/send`, class: 'button button--quiet', text: 'Next: check and send' }),
    tabBar('profile'),
  ];
}
