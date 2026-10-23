/* ══════════════════════════════════════════════════════════════════
   STREETO — admin console: the manual editor
   The articles on the left, the live page on the right. Every change
   is saved as it is typed and the preview follows. The articles and
   the lines inside them are dragged into place.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { flash, confirmDialog } from './app.js';

const csrf = document.querySelector('meta[name="csrf-token"]')?.content;

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'fetch',
      'x-csrf-token': csrf,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ── saving ────────────────────────────────────────────────────── */
const timers = new WeakMap();

/** Save a field a moment after the typing stops. */
function liveSave(input, build) {
  if (!input) return;
  const run = async () => {
    const payload = build(input);
    if (!payload) return;
    try {
      await post(payload.url, payload.body);
    } catch (error) {
      flash(error.message);
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timers.get(input));
    timers.set(input, setTimeout(run, 700));
  });
  input.addEventListener('blur', () => {
    clearTimeout(timers.get(input));
    run();
  });
}

/** The Georgian of a key. The English side is the key. */
function saveGeorgian(input, keyInput) {
  liveSave(input, (el) => {
    const key = keyInput?.value?.trim();
    if (!key) return null;
    return { url: '/admin/translations', body: { key, value: el.value } };
  });
}

document.querySelectorAll('[data-section]').forEach((section) => {
  const id = section.dataset.section;
  const en = section.querySelector('[data-sec-en]');
  const ka = section.querySelector('[data-sec-ka]');

  // The English heading is the key, so it is saved first and the
  // Georgian follows it to the new key.
  liveSave(en, (el) => ({ url: `/admin/how-it-works/section/${id}`, body: { heading: el.value } }));
  en.addEventListener('input', () => {
    // Move the Georgian over to the new key.
    if (!ka) return;
    clearTimeout(timers.get(ka));
    timers.set(ka, setTimeout(async () => {
      try {
        await post('/admin/translations', { key: en.value.trim(), value: ka.value });
      } catch (error) { /* the key is not there yet */ }
    }, 1400));
  });
  saveGeorgian(ka, en);

  // The icon is chosen from the library, which saves it itself.
  section.querySelector('[data-sec-up]')?.addEventListener('click', () => moveSection(id, 'up'));
  section.querySelector('[data-sec-down]')?.addEventListener('click', () => moveSection(id, 'down'));
  section.querySelector('[data-sec-delete]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('Remove this article and everything in it? The Georgian text goes with it.'), { confirmLabel: t('Remove'), danger: true }))) return;
    try {
      await post(`/admin/how-it-works/section/${id}/delete`, {});
      section.remove();
    } catch (error) { flash(error.message); }
  });
});

document.querySelectorAll('[data-block]').forEach((block) => {
  const id = block.dataset.block;
  const en = block.querySelector('[data-block-en]');
  const ka = block.querySelector('[data-block-ka]');
  const section = block.closest('[data-section]');
  const sectionId = section?.dataset.section;

  liveSave(en, (el) => ({ url: `/admin/how-it-works/block/${id}`, body: { body: el.value } }));
  en.addEventListener('input', () => {
    if (!ka) return;
    clearTimeout(timers.get(ka));
    timers.set(ka, setTimeout(async () => {
      try {
        await post('/admin/translations', { key: en.value.trim(), value: ka.value });
      } catch (error) { /* the key is not there yet */ }
    }, 1400));
  });
  saveGeorgian(ka, en);

  block.querySelector('[data-block-kind]')?.addEventListener('change', async (event) => {
    try {
      await post(`/admin/how-it-works/block/${id}`, { kind: event.target.value });
    } catch (error) { flash(error.message); }
  });

  block.querySelector('[data-block-delete]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('Remove this line? The Georgian text goes with it.'), { confirmLabel: t('Remove'), danger: true }))) return;
    try {
      await post(`/admin/how-it-works/block/${id}/delete`, {});
      block.remove();
    } catch (error) { flash(error.message); }
  });
});

async function moveSection(id, direction) {
  try {
    await post(`/admin/how-it-works/section/${id}/move`, { direction });
    window.location.reload();
  } catch (error) { flash(error.message); }
}

/* ── drag and drop ─────────────────────────────────────────────── */
let dragging = null;

function clearDropMarks() {
  document.querySelectorAll('.is-drop-before, .is-drop-after, .is-dragging').forEach((el) => {
    el.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging');
  });
}

document.addEventListener('dragstart', (event) => {
  const sectionGrip = event.target.closest('[data-drag-section]');
  const blockGrip = event.target.closest('[data-drag-block]');
  if (sectionGrip) {
    dragging = { kind: 'section', id: sectionGrip.dataset.dragSection };
    sectionGrip.closest('.howart')?.classList.add('is-dragging');
  } else if (blockGrip) {
    dragging = { kind: 'block', id: blockGrip.dataset.dragBlock };
    blockGrip.closest('.howline')?.classList.add('is-dragging');
  } else {
    return;
  }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragging.id);
});

document.addEventListener('dragover', (event) => {
  if (!dragging) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  if (dragging.kind === 'section') {
    const target = event.target.closest('.howart');
    if (!target || target.dataset.section === dragging.id) return;
    const box = target.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    target.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  } else {
    const target = event.target.closest('.howline');
    if (!target || target.dataset.block === dragging.id) return;
    const box = target.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    target.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  }
});

document.addEventListener('drop', async (event) => {
  if (!dragging) return;
  event.preventDefault();
  const item = dragging;
  const marks = document.querySelectorAll('.is-drop-before, .is-drop-after');
  const mark = marks[0];
  clearDropMarks();
  dragging = null;
  if (!mark) return;

  try {
    if (item.kind === 'section') {
      const target = mark.closest('.howart');
      const siblings = [...document.querySelectorAll('.howart[data-section]')];
      let index = siblings.indexOf(target);
      if (mark.classList.contains('is-drop-after')) index += 1;
      const data = await post(`/admin/how-it-works/section/${item.id}/move`, { position: index });
      if (data.sections) window.location.reload();
    } else {
      const target = mark.closest('.howline');
      const section = target?.closest('[data-section]');
      const siblings = [...(section?.querySelectorAll('.howline') || [])];
      let index = siblings.indexOf(target);
      if (mark.classList.contains('is-drop-after')) index += 1;
      await post(`/admin/how-it-works/block/${item.id}/move`, {
        position: index,
        section_id: section?.dataset.section,
      });
      window.location.reload();
    }
  } catch (error) { flash(error.message); }
});

document.addEventListener('dragend', () => {
  clearDropMarks();
  dragging = null;
});

/* ── the icon picker ───────────────────────────────────────────── */
const iconDialog = document.getElementById('how-icon-dialog');
/* Where the picked icon goes: the field that holds the name, the button
   that shows it and, for an existing article, the card to save it on. */
let iconTarget = null;

document.querySelectorAll('[data-icon-pick]').forEach((button) => {
  button.addEventListener('click', () => {
    const selector = button.dataset.iconTarget;
    if (selector) {
      // A field in a modal - the new article form.
      const field = document.querySelector(selector);
      iconTarget = { field, holder: button.querySelector('svg'), section: null };
    } else {
      // An article card - the icon is saved on the spot.
      const section = button.closest('[data-section]');
      iconTarget = {
        field: section?.querySelector('[data-sec-icon]'),
        holder: button.querySelector('svg'),
        section,
      };
    }
    openDialog(iconDialog);
  });
});

/* The strip of icons the manual uses right now. It is rebuilt after
   every pick, so it always tells the truth. */
const refreshUsedIcons = () => {
  const strip = iconDialog?.querySelector('[data-used-strip]');
  if (!strip) return;
  const inUse = [...new Set(
    [...document.querySelectorAll('[data-section] [data-sec-icon]')]
      .map((field) => field.value)
      .filter(Boolean),
  )];
  strip.replaceChildren();
  for (const name of inUse) {
    const source = iconDialog.querySelector(`[data-icon-grid] .iconlib__btn[data-icon="${name}"]`);
    if (!source) continue;
    const button = source.cloneNode(true);
    button.classList.remove('is-used');
    strip.appendChild(button);
  }
  // The full grid shows which icons are in use.
  iconDialog.querySelectorAll('[data-icon-grid] .iconlib__btn').forEach((button) => {
    button.classList.toggle('is-used', inUse.includes(button.dataset.icon));
  });
};

iconDialog?.addEventListener('click', async (event) => {
  const choice = event.target.closest('[data-icon]');
  if (!choice || !iconTarget) return;
  const name = choice.dataset.icon;
  if (iconTarget.field) iconTarget.field.value = name;
  // The button shows the icon it just picked.
  const svg = choice.querySelector('svg');
  const holder = iconTarget.holder;
  if (svg && holder) {
    holder.innerHTML = svg.innerHTML;
    holder.setAttribute('width', '16');
    holder.setAttribute('height', '16');
  }
  const section = iconTarget.section;
  iconDialog.close();
  if (!section) return;
  try {
    await post(`/admin/how-it-works/section/${section.dataset.section}`, { icon: name });
  } catch (error) { flash(error.message); }
  refreshUsedIcons();
});

/* ── the modals ────────────────────────────────────────────────── */
const sectionDialog = document.getElementById('how-section-dialog');
const blockDialog = document.getElementById('how-block-dialog');

const openDialog = (dialog) => {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
};

document.querySelectorAll('[data-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog')?.close());
});

document.querySelectorAll('[data-add-section-open]').forEach((button) => {
  button.addEventListener('click', () => {
    // The dialog has to be open before a field inside it can be focused.
    openDialog(sectionDialog);
    sectionDialog?.querySelector('[name="heading"]')?.focus();
  });
});

const sectionForm = sectionDialog?.querySelector('[data-section-form]');
const blockForm = blockDialog?.querySelector('[data-block-form]');

sectionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const heading = String(data.get('heading') || '').trim();
  if (!heading) return;
  try {
    const created = await post('/admin/how-it-works/section', {
      heading,
      icon: data.get('icon') || 'bolt',
    });
    const ka = String(data.get('heading_ka') || '').trim();
    if (ka && created.section) {
      await post('/admin/translations', { key: heading, value: ka });
    }
    window.location.reload();
  } catch (error) { flash(error.message); }
});

document.querySelectorAll('[data-add-block-open]').forEach((button) => {
  button.addEventListener('click', () => {
    const sectionId = button.dataset.addBlockOpen;
    const form = blockDialog?.querySelector('[data-block-form]');
    const field = form?.querySelector('[name="section_id"]');
    if (field) field.value = sectionId;
    openDialog(blockDialog);
    form?.querySelector('[name="body"]')?.focus();
  });
});

blockForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const body = String(data.get('body') || '').trim();
  if (!body) return;
  try {
    const created = await post('/admin/how-it-works/block', {
      section_id: data.get('section_id'),
      kind: data.get('kind'),
      body,
    });
    const ka = String(data.get('body_ka') || '').trim();
    if (ka && created.block) {
      await post('/admin/translations', { key: body, value: ka });
    }
    window.location.reload();
  } catch (error) { flash(error.message); }
});
