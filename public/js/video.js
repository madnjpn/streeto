/*
   Video cards: custom play cover, duration label and a short silent preview
   on hover (desktop only). The video file itself only loads after a click or
   hover, so the feed stays light.
*/
const canHover =
  window.matchMedia?.('(hover: hover) and (pointer: fine)').matches &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

for (const player of document.querySelectorAll('[data-video-player]')) {
  const video = player.querySelector('video');
  const play = player.querySelector('[data-video-play]');
  const badge = player.querySelector('[data-video-duration]');
  if (!video) continue;

  let userStarted = false;
  let hoverTimer = null;
  let hovering = false;

  const setDuration = () => {
    if (!badge) return;
    const text = durationText(video.duration);
    badge.textContent = text;
    badge.hidden = !text;
  };

  if (video.readyState >= 1) setDuration();
  video.addEventListener('loadedmetadata', setDuration);

  video.addEventListener('play', () => {
    // Keep the cover while the silent hover preview is running; it is the
    // way to switch to sound.
    if (!video.muted || userStarted) player.classList.add('is-playing');
    if (!video.muted) userStarted = true;
  });
  video.addEventListener('pause', () => player.classList.remove('is-playing'));
  video.addEventListener('ended', () => player.classList.remove('is-playing'));

  const stopHover = () => {
    hovering = false;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  play?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    userStarted = true;
    stopHover();
    video.muted = false;
    player.classList.add('is-playing');
    video.play().catch(() => {});
  });

  if (!canHover) continue;

  player.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse' || userStarted) return;
    hovering = true;
    video.muted = true;
    video.play().then(() => {
      hoverTimer = setTimeout(() => {
        if (userStarted) return;
        video.pause();
        video.currentTime = 0;
        video.muted = false;
      }, 2600);
    }).catch(() => {
      video.muted = false;
      stopHover();
    });
  });

  player.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse' || !hovering || userStarted) return;
    stopHover();
    video.pause();
    video.currentTime = 0;
    video.muted = false;
  });
}
