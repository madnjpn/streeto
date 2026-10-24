/*
 * Share a public preview card. Uses the native share sheet when it can
 * carry a file (Android / iOS), and falls back to downloading the card and
 * copying the page link on desktop.
 */
import { t } from './i18n.js';

const toast = (message) => {
  const el = document.createElement('div');
  el.className = 'share-card-toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
};

const safeFile = (title) =>
  `${String(title || 'streeto')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'streeto'}.png`;

async function shareCard(button) {
  const imageUrl = button.dataset.shareCardImage;
  const pageUrl = button.dataset.shareCardUrl || location.href;
  const title = button.dataset.shareCardTitle || document.title;
  if (!imageUrl) return;

  button.disabled = true;
  try {
    const response = await fetch(imageUrl, { credentials: 'omit' });
    if (!response.ok) throw new Error('card unavailable');
    const blob = await response.blob();
    const file = new File([blob], safeFile(title), { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, text: title, url: pageUrl, files: [file] });
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

    try {
      await navigator.clipboard.writeText(pageUrl);
      toast(t('Card downloaded · link copied'));
    } catch {
      toast(t('Card downloaded'));
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      try {
        await navigator.clipboard.writeText(pageUrl);
        toast(t('Link copied'));
      } catch {
        window.open(pageUrl, '_blank', 'noopener');
      }
    }
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-share-card]');
  if (!button) return;
  event.preventDefault();
  shareCard(button);
});
