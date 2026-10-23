/* ══════════════════════════════════════════════════════════════════
   STREETO — main client behaviour
   Progressive enhancement only: every action also works as a plain
   form post if this file fails to load.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { attachMentions } from './mentions.js';

const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
const authed = document.body.dataset.authed === '1';

/* ── tiny helpers ───────────────────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Open a custom modal (div.modal) by selector. */
export function openModal(selector) {
  const modal = $(selector);
  if (modal) {
    modal.hidden = false;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    // Focus first focusable element
    const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
  }
}

/** Close a custom modal (div.modal) by selector. */
export function closeModal(selector) {
  const modal = $(selector);
  if (modal) {
    modal.hidden = true;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}

/** Close modal when clicking backdrop or pressing Escape. */
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-dismiss]')) {
    const modal = e.target.closest('.modal');
    if (modal) closeModal('#' + modal.id);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.modal.is-open').forEach(m => closeModal('#' + m.id));
  }
});

async function api(url, { method = 'POST', body = null, json = false } = {}) {
  const headers = { 'x-requested-with': 'fetch', 'x-csrf-token': csrf };
  let payload = body;
  if (json && body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({ ok: false, error: t('Server error ({status})', { status: response.status }) }));
  if (!response.ok || data.ok === false) throw new Error(data.error || t('Request failed ({status})', { status: response.status }));
  return data;
}

export function flash(message, type = 'error') {
  const host = $('.flashes') || (() => {
    const div = document.createElement('div');
    div.className = 'flashes';
    $('#main')?.prepend(div);
    return div;
  })();
  if (!host) return;
  const el = document.createElement('div');
  el.className = `flash flash--${type}`;
  el.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.textContent = message;
  el.append(span);
  host.prepend(el);
  setTimeout(() => el.remove(), 6000);
}

function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('is-busy', busy);
}

/* ── dropdown menus ─────────────────────────────────────────────── */
function closeMenus(except = null) {
  $$('[data-menu]').forEach((menu) => {
    if (menu === except) return;
    const panel = $('[data-menu-panel]', menu);
    const toggle = $('[data-menu-toggle]', menu);
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-menu-toggle]');
  if (toggle) {
    event.preventDefault();
    const menu = toggle.closest('[data-menu]');
    const panel = $('[data-menu-panel]', menu);
    const willOpen = panel.hidden;
    closeMenus(menu);
    panel.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', String(willOpen));
    return;
  }
  if (!event.target.closest('[data-menu-panel]')) closeMenus();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
});

/* ── flash messages ─────────────────────────────────────────────── */
$$('[data-flash]').forEach((el) => {
  setTimeout(() => el.remove(), 9000);
});
document.addEventListener('click', (event) => {
  const closer = event.target.closest('[data-flash-close]');
  if (closer) closer.closest('[data-flash]')?.remove();
});

/* ── confirmations ──────────────────────────────────────────────── */
/* window.confirm() is a white OS box that ignores the theme, so the
   yes/no prompts are built from the app's own modal instead. Returns
   a promise that resolves true when the driver confirms. */
export function confirmDialog(message, { confirmLabel = '', cancelLabel = '', danger = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--sm dialog--confirm';

    const body = document.createElement('div');
    body.className = 'dialog__body';
    const text = document.createElement('p');
    text.textContent = message;
    body.append(text);

    const foot = document.createElement('div');
    foot.className = 'dialog__foot';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost';
    cancel.textContent = cancelLabel || t('Cancel');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'btn btn--danger' : 'btn btn--primary';
    ok.textContent = confirmLabel || t('Confirm');
    foot.append(cancel, ok);
    dialog.append(body, foot);
    document.body.append(dialog);

    const done = (value) => {
      resolve(value);
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    // Escape fires `cancel`; keep focus in the app rather than closing silently.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      done(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) done(false);
    });

    dialog.showModal();
    ok.focus();
  });
}

/* The guard below must exist only once. If this file is ever reached
   under two different urls (the stamped path and the plain one), the
   browser runs it twice - and the second copy would see the "already
   submitting" mark the first one left behind and cancel every form on
   the page. */
if (!window.__streetoSubmitGuard) {
  window.__streetoSubmitGuard = true;
  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    // A double click (or a slow connection plus an impatient user) must not
    // create the same thing twice. The confirm dialog below re-submits the
    // form on purpose, so that one is let through and only marked.
    if (form.dataset.confirmed === '1') {
      form.dataset.submitting = '1';
      return;
    }
    if (form.dataset.submitting === '1') {
      event.preventDefault();
      return;
    }

    const message = form.dataset.confirm;
    if (!message) {
      form.dataset.submitting = '1';
      return;
    }

    // Stop the submit now, ask, then hand it back to the browser.
    event.preventDefault();

    const button = form.querySelector('button[type="submit"], button:not([type])');
    const ok = await confirmDialog(message, {
      confirmLabel: button ? button.textContent.trim() : '',
      danger: Boolean(form.querySelector('.btn--danger')),
    });
    if (!ok) return;

    form.dataset.confirmed = '1';
    form.requestSubmit();
  });
}

/* ── modal-styled select ────────────────────────────────────────── */
function initSelectModals() {
  document.querySelectorAll('[data-selectmodal]').forEach((root) => {
    if (root.dataset.ready === '1') return;
    root.dataset.ready = '1';
    const input = root.querySelector('[data-selectmodal-input]');
    const trigger = root.querySelector('[data-selectmodal-trigger]');
    const labelEl = root.querySelector('[data-selectmodal-label]');
    if (!input || !trigger) return;

    const options = Array.from(input.options).map((o) => ({ value: o.value, label: o.text }));

    const buildDialog = () => {
      const dialog = document.createElement('div');
      dialog.className = 'selectmodal__dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.hidden = true;

      const panel = document.createElement('div');
      panel.className = 'selectmodal__panel';

      const head = document.createElement('div');
      head.className = 'selectmodal__head';
      const title = document.createElement('strong');
      title.textContent = trigger.getAttribute('aria-label') || trigger.textContent.trim();
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'selectmodal__close';
      closeBtn.setAttribute('aria-label', t('Close'));
      closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      head.append(title, closeBtn);

      const list = document.createElement('div');
      list.className = 'selectmodal__list';

      options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `selectmodal__opt${opt.value === input.value ? ' is-active' : ''}`;
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          input.value = opt.value;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          list.querySelectorAll('.selectmodal__opt').forEach((b) => b.classList.toggle('is-active', b === btn));
          if (labelEl) labelEl.textContent = opt.label;
          dialog.hidden = true;
        });
        list.append(btn);
      });

      panel.append(head, list);
      dialog.append(panel);
      document.body.append(dialog);

      const close = () => { dialog.hidden = true; };

      trigger.addEventListener('click', () => {
        dialog.hidden = false;
        closeBtn.focus();
      });
      closeBtn.addEventListener('click', close);
      dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dialog.hidden) close(); });
    };

    buildDialog();
  });
}

/* ── lightbox ───────────────────────────────────────────────────── */
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-lightbox]');
  if (!link) return;
  const img = link.querySelector('img');
  if (!img) return;
  event.preventDefault();

  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', t('Photo viewer'));
  const big = document.createElement('img');
  big.src = link.getAttribute('href') || img.src;
  big.alt = img.alt || '';
  const close = document.createElement('button');
  close.className = 'lightbox__close';
  close.type = 'button';
  close.setAttribute('aria-label', t('Close'));
  close.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  box.append(big, close);
  document.body.append(box);

  const dismiss = () => box.remove();
  close.addEventListener('click', dismiss);
  box.addEventListener('click', (e) => { if (e.target === box) dismiss(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', onKey);
    }
  });
});

/* ── likes ──────────────────────────────────────────────────────── */
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-like]');
  if (!btn || btn.disabled) return;
  event.preventDefault();

  const id = btn.dataset.like;
  const countEl = $(`[data-like-count="${id}"]`);
  setBusy(btn, true);
  try {
    const data = await api(`/posts/${id}/like`);
    btn.classList.toggle('is-on', data.liked);
    btn.classList.add('is-bump');
    btn.setAttribute('aria-pressed', String(data.liked));
    if (countEl) countEl.textContent = data.likes;
    setTimeout(() => btn.classList.remove('is-bump'), 400);
  } catch (error) {
    flash(error.message);
  } finally {
    setBusy(btn, false);
  }
});

/* ── comments: toggle, load, add, delete ────────────────────────── */
async function loadComments(postId) {
  const list = $(`[data-comments-list="${postId}"]`);
  if (!list || list.dataset.loaded === '1') return;
  // Never throw away a comment the driver is in the middle of writing.
  if (list.querySelector('[data-comment-edit-form]:not([hidden]), [data-reply-form]:not([hidden])')) return;
  list.dataset.loaded = '1';
  const loading = $('[data-comments-loading]', list);
  try {
    const data = await api(`/posts/${postId}/comments`, { method: 'GET' });
    list.innerHTML = data.html || '';
    if (!list.children.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = t('No comments yet. Be the first.');
      list.append(p);
    }
    wireMentions(list);
  } catch (error) {
    list.dataset.loaded = '0';
    if (loading) loading.textContent = error.message;
  }
}

/** Give every comment and reply field its @mention autocomplete. */
function wireMentions(scope) {
  (scope || document).querySelectorAll('input[name="body"], textarea[name="body"]').forEach((input) => {
    if (input.dataset.mentions === '1') return;
    input.dataset.mentions = '1';
    attachMentions(input);
  });
}

// Comments that came down with the page are already rendered; the rest
// are fetched as soon as their section is visible.
$$('[data-comments]:not([hidden])').forEach((section) => loadComments(section.dataset.comments));
wireMentions(document);

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-comments-toggle]');
  if (!toggle) return;
  event.preventDefault();
  const id = toggle.dataset.commentsToggle;
  const section = $(`[data-comments="${id}"]`);
  if (!section) return;
  const willShow = section.hidden;
  section.hidden = !willShow;
  toggle.setAttribute('aria-expanded', String(willShow));
  if (willShow) {
    loadComments(id);
    setTimeout(() => $('input[name="body"]', section)?.focus({ preventScroll: true }), 60);
  }
});

// Auto-open the comment box when a post link targets a comment.
if (location.hash.startsWith('#post-')) {
  const id = location.hash.slice(6);
  const section = $(`[data-comments="${id}"]`);
  if (section && !section.hidden) loadComments(id);
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-comment-form]');
  if (!form) return;
  event.preventDefault();

  const postId = form.dataset.commentForm;
  const input = $('input[name="body"]', form);
  const body = input.value.trim();
  if (!body) return;

  const submit = $('button[type="submit"]', form);
  setBusy(submit, true);
  try {
    // URLSearchParams keeps this a normal form-encoded post, which the
    // server's urlencoded parser understands.
    const data = await api(form.action, { body: new URLSearchParams(new FormData(form)) });
    if (form.hasAttribute('data-reply-form')) {
      // A reply goes under the comment it answers - and a reply can be
      // answered as well, so the box may sit inside another reply.
      const parentId = form.querySelector('[name="parent_id"]')?.value;
      const box = parentId ? $(`[data-replies="${parentId}"]`) : null;
      if (box) {
        box.insertAdjacentHTML('beforeend', data.html);
        wireMentions(box);
      }
      form.reset();
      form.hidden = true;
    } else {
      const list = $(`[data-comments-list="${postId}"]`);
      if (list) {
        list.querySelector('.muted.small')?.remove();
        list.insertAdjacentHTML('beforeend', data.html);
      }
      input.value = '';
    }
    const count = $(`[data-comment-count="${postId}"]`);
    if (count) count.textContent = data.count;
    const section = $(`[data-comments="${postId}"]`);
    if (section) section.hidden = false;
  } catch (error) {
    flash(error.message);
  } finally {
    setBusy(submit, false);
  }
});

/* ── reply to a comment ─────────────────────────────────────────── */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-reply-to]');
  if (button) {
    event.preventDefault();
    const comment = button.closest('[data-comment]');
    const form = comment?.querySelector('[data-reply-form]');
    if (!form) return;
    // Only one reply box open at a time.
    document.querySelectorAll('[data-reply-form]').forEach((other) => { other.hidden = true; });
    form.hidden = false;
    const input = form.querySelector('input[name="body"]');
    input?.focus({ preventScroll: true });
    return;
  }

  const cancel = event.target.closest('[data-reply-cancel]');
  if (cancel) {
    event.preventDefault();
    const form = cancel.closest('[data-reply-form]');
    if (form) form.hidden = true;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-comment-delete]');
  if (!form) return;
  event.preventDefault();
  if (!(await confirmDialog(t('Delete this comment?'), { confirmLabel: t('Delete'), danger: true }))) return;

  try {
    await api(form.action, { body: new URLSearchParams(new FormData(form)) });
    const item = form.closest('[data-comment]');
    item?.remove();
    const post = form.closest('[data-post]');
    const id = post?.dataset.post;
    const count = id ? $(`[data-comment-count="${id}"]`) : null;
    if (count) count.textContent = Math.max(0, Number(count.textContent) - 1);
  } catch (error) {
    flash(error.message);
  }
});

/* ── edit a comment ─────────────────────────────────────────────── */
/**
 * The words of a comment can be changed by the person who wrote it.
 * The box replaces the text in place, and the server sends the new
 * text back already made safe to show.
 */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-comment-edit]');
  if (button) {
    event.preventDefault();
    const comment = button.closest('[data-comment]');
    const form = comment?.querySelector('[data-comment-edit-form]');
    const body = comment?.querySelector('[data-comment-body]');
    if (!form || !body) return;
    body.hidden = true;
    form.hidden = false;
    const area = form.querySelector('[data-comment-edit-text]');
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
    return;
  }

  const cancel = event.target.closest('[data-comment-edit-cancel]');
  if (cancel) {
    event.preventDefault();
    const form = cancel.closest('[data-comment-edit-form]');
    const comment = form?.closest('[data-comment]');
    const body = comment?.querySelector('[data-comment-body]');
    if (form) form.hidden = true;
    if (body) body.hidden = false;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-comment-edit-form]');
  if (!form) return;
  event.preventDefault();

  const area = form.querySelector('[data-comment-edit-text]');
  const body = area.value.trim();
  if (!body) return;

  const submit = $('button[type="submit"]', form);
  setBusy(submit, true);
  try {
    const data = await api(form.action, { body: new URLSearchParams(new FormData(form)) });
    const comment = form.closest('[data-comment]');
    const text = comment?.querySelector('[data-comment-body]');
    if (text) {
      text.innerHTML = data.body_html || '';
      text.hidden = false;
    }
    // The comment now shows that it was edited.
    const time = comment?.querySelector('.comment__who time');
    if (time && !time.querySelector('.comment__edited')) {
      const mark = document.createElement('span');
      mark.className = 'comment__edited';
      mark.textContent = t('edited');
      time.append(document.createTextNode(' · '), mark);
    }
    form.hidden = true;
    wireMentions(comment || document);
  } catch (error) {
    flash(error.message);
  } finally {
    setBusy(submit, false);
  }
});

/* ── edit a post ────────────────────────────────────────────────── */
/**
 * The words of a post can be changed by the person who wrote it. The
 * hashtags under the post follow the new text.
 */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-post-edit]');
  if (button) {
    event.preventDefault();
    closeMenus();
    const post = button.closest('[data-post]');
    const form = post?.querySelector('[data-post-edit-form]');
    const body = post?.querySelector('[data-post-body]');
    if (!form) return;
    if (body) body.hidden = true;
    form.hidden = false;
    const area = form.querySelector('[data-post-edit-text]');
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
    return;
  }

  const cancel = event.target.closest('[data-post-edit-cancel]');
  if (cancel) {
    event.preventDefault();
    const form = cancel.closest('[data-post-edit-form]');
    const post = form?.closest('[data-post]');
    const body = post?.querySelector('[data-post-body]');
    if (form) form.hidden = true;
    if (body) body.hidden = false;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-post-edit-form]');
  if (!form) return;
  event.preventDefault();

  const area = form.querySelector('[data-post-edit-text]');
  const body = area.value.trim();
  if (!body) return;

  const submit = $('button[type="submit"]', form);
  setBusy(submit, true);
  try {
    const data = await api(form.action, { body: new URLSearchParams(new FormData(form)) });
    const post = form.closest('[data-post]');
    const text = post?.querySelector('[data-post-body]');
    if (text) {
      text.innerHTML = data.body_html || '';
      text.hidden = false;
    }
    // The hashtags follow the new text.
    const tags = post?.querySelector('.post__tags');
    if (tags && data.tags_html) {
      tags.outerHTML = data.tags_html;
    } else if (tags && !data.tags_html) {
      tags.remove();
    }
    // The post now shows that it was edited.
    const time = post?.querySelector('.post__meta time');
    if (time && !time.querySelector('.post__edited')) {
      const mark = document.createElement('span');
      mark.className = 'post__edited';
      mark.textContent = t('edited');
      time.append(document.createTextNode(' · '), mark);
    }
    form.hidden = true;
    wireMentions(post || document);
  } catch (error) {
    flash(error.message);
  } finally {
    setBusy(submit, false);
  }
});

/* ── react to a comment ─────────────────────────────────────────── */
/** The emojis a driver can press on a comment. */
const REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '😮', '😢', '🙏'];

let commentPicker = null;

/** Close the little strip of emojis. */
function hideCommentPicker() {
  if (!commentPicker) return;
  commentPicker.remove();
  commentPicker = null;
}

/** The strip of emojis that opens next to a comment. */
function showCommentPicker(commentEl) {
  hideCommentPicker();
  setTimeout(() => {
    const box = document.createElement('div');
    box.className = 'reactpicker';
    for (const emoji of REACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = emoji;
      button.addEventListener('click', () => {
        reactToComment(commentEl, emoji);
        hideCommentPicker();
      });
      box.appendChild(button);
    }
    document.body.appendChild(box);
    const rect = commentEl.getBoundingClientRect();
    const width = box.offsetWidth || 220;
    const left = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(rect.bottom + 6, 8), Math.max(8, window.innerHeight - 56));
    box.style.top = `${top}px`;
    box.style.left = `${left}px`;
    commentPicker = box;
  }, 0);
}

/** Rebuild the reaction bar under a comment. */
function renderCommentReactions(commentEl, list) {
  const bar = commentEl.querySelector('[data-reacts]');
  if (!bar) return;
  bar.replaceChildren();
  for (const reaction of list || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `react${reaction.mine ? ' is-mine' : ''}`;
    button.setAttribute('data-react', reaction.emoji);
    button.title = (reaction.who || []).map((w) => `@${w.username}`).join(', ');
    const emoji = document.createElement('span');
    emoji.textContent = reaction.emoji;
    const count = document.createElement('span');
    count.textContent = String(reaction.count);
    button.append(emoji, count);
    bar.appendChild(button);
  }
}

async function reactToComment(commentEl, emoji) {
  const id = commentEl?.dataset?.comment;
  if (!id) return;
  try {
    const res = await fetch(`/comments/${id}/react`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'fetch', 'x-csrf-token': csrf },
      body: new URLSearchParams({ emoji, _csrf: csrf }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || t('Could not save that.'));
    renderCommentReactions(commentEl, data.reactions || []);
  } catch (error) {
    flash(error.message);
  }
}

document.addEventListener('click', (event) => {
  // Pressing an emoji that is already there takes it back.
  const pressed = event.target.closest('[data-comment] [data-react]');
  if (pressed) {
    event.preventDefault();
    const commentEl = pressed.closest('[data-comment]');
    reactToComment(commentEl, pressed.dataset.react);
    return;
  }

  const button = event.target.closest('[data-comment-react]');
  if (button) {
    event.preventDefault();
    const commentEl = button.closest('[data-comment]');
    if (commentEl) showCommentPicker(commentEl);
    return;
  }

  if (commentPicker && !event.target.closest('.reactpicker')) hideCommentPicker();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideCommentPicker();
});

/* ── friends ────────────────────────────────────────────────────── */
function usernameFrom(el) {
  const link = el.closest('.person, .row, .mini__person, .faces__item')?.querySelector('a[href^="/u/"]');
  return link ? decodeURIComponent(link.getAttribute('href').replace('/u/', '')) : '';
}

function setFriendButton(btn, { state, label, id, username }) {
  if (!btn) return;
  const span = btn.querySelector('span');
  const setText = (text) => { if (span) span.textContent = text; else btn.textContent = text; };
  ['data-friend-add', 'data-unfriend', 'data-friend-cancel', 'data-friend-accept', 'data-friend-decline']
    .forEach((attr) => btn.removeAttribute(attr));
  btn.classList.remove('btn--primary', 'btn--outline', 'is-on');
  btn.classList.add('btn--ghost');
  btn.disabled = false;

  if (state === 'friends') {
    btn.dataset.unfriend = username || '';
    btn.classList.add('is-on');
    setText(label || t('Friends'));
  } else if (state === 'requested') {
    btn.dataset.friendCancel = id;
    setText(label || t('Requested'));
  } else {
    btn.dataset.friendAdd = username || '';
    btn.classList.remove('btn--ghost');
    btn.classList.add('btn--primary');
    setText(label || t('Add friend'));
  }
}

async function friendRequest(url, btn, onDone) {
  setBusy(btn, true);
  try {
    const data = await api(url);
    onDone(data);
  } catch (error) {
    flash(error.message);
    setBusy(btn, false);
  }
}

document.addEventListener('click', async (event) => {
  const add = event.target.closest('[data-friend-add]');
  if (add) {
    event.preventDefault();
    const username = add.dataset.friendAdd;
    if (!username) return;
    friendRequest(`/friends/request/${encodeURIComponent(username)}`, add, (data) => {
      setFriendButton(add, { state: data.accepted ? 'friends' : 'requested', id: data.id, username });
      flash(data.accepted ? t('You and @{user} are friends.', { user: username }) : t('Request sent to @{user}.', { user: username }), 'success');
    });
    return;
  }

  const accept = event.target.closest('[data-friend-accept]');
  if (accept) {
    event.preventDefault();
    const username = usernameFrom(accept);
    friendRequest(`/friends/accept/${accept.dataset.friendAccept}`, accept, () => {
      setFriendButton(accept, { state: 'friends', username, label: t('Friends') });
      const card = accept.closest('.person');
      // On the friends page the request card is no longer needed.
      if (card && location.pathname === '/friends' && !card.querySelector('[data-friend-decline]')) card.remove();
      flash(t('Friend request accepted.'), 'success');
    });
    return;
  }

  const decline = event.target.closest('[data-friend-decline]');
  if (decline) {
    event.preventDefault();
    friendRequest(`/friends/decline/${decline.dataset.friendDecline}`, decline, () => {
      decline.closest('.person')?.remove();
      flash(t('Request declined.'), 'success');
    });
    return;
  }

  const cancel = event.target.closest('[data-friend-cancel]');
  if (cancel) {
    event.preventDefault();
    friendRequest(`/friends/cancel/${cancel.dataset.friendCancel}`, cancel, (data) => {
      if (data.cancelled) {
        const row = cancel.closest('.row, .person');
        if (row) row.remove();
        else setFriendButton(cancel, { state: 'none', username: usernameFrom(cancel), label: t('Add friend') });
      }
    });
    return;
  }

  const unfriend = event.target.closest('[data-unfriend]');
  if (unfriend) {
    event.preventDefault();
    const username = unfriend.dataset.unfriend || usernameFrom(unfriend);
    if (!username) return;
    if (!(await confirmDialog(
      t('Remove @{user} from your group?', { user: username }),
      { confirmLabel: t('Remove'), danger: true },
    ))) return;
    friendRequest(`/friends/remove/${encodeURIComponent(username)}`, unfriend, () => {
      setFriendButton(unfriend, { state: 'none', username, label: t('Add friend') });
      flash(t('@{user} removed.', { user: username }), 'success');
    });
  }
});

/* ── composer: media preview, pin panel, SOS, counter ───────────── */
function initComposer(form) {
  const text = $('[data-composer-text]', form);
  const counter = $('[data-counter]', form);
  const mediaInput = $('[data-media-input]', form);
  const preview = $('[data-media-preview]', form);
  const pinToggle = $('[data-pin-toggle]', form);
  const sosToggle = $('[data-sos-toggle]', form);
  const pinPanel = $('[data-pin-panel]', form);
  const pollToggle = $('[data-poll-toggle]', form);
  const pollPanel = $('[data-poll-panel]', form);
  const typeInput = $('[data-post-type]', form);
  const hint = $('[data-composer-hint]', form);
  const submitLabel = $('[data-submit-label]', form);
  const quality = $('[data-quality]', form);
  const qualityInput = $('[data-quality-input]', form);

  /* The picture may be small and quick, or full size. */
  quality?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quality-value]');
    if (!button) return;
    const value = button.dataset.qualityValue === 'hd' ? 'hd' : 'sd';
    if (qualityInput) qualityInput.value = value;
    quality.querySelectorAll('[data-quality-value]').forEach((btn) => {
      btn.classList.toggle('is-on', btn === button);
    });
  });

  const setType = (type) => {
    if (typeInput) typeInput.value = type;
    form.classList.toggle('pin-mode', type === 'location' || type === 'emergency');
    if (pinToggle) pinToggle.classList.toggle('is-on', type === 'location' || type === 'emergency');
    if (sosToggle) sosToggle.classList.toggle('is-on', type === 'emergency');
    if (submitLabel) submitLabel.textContent = type === 'emergency' ? t('Send SOS') : t('Post');
    if (hint) {
      hint.textContent = type === 'emergency'
        ? t('SOS posts need a pin so people can find you. Only use this for real emergencies.')
        : '';
    }
  };

  const openPin = (open) => {
    if (pinPanel) pinPanel.hidden = !open;
    if (open) {
      pinPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      window.StreetoMaps?.initPick(pinPanel);
    }
  };

  text?.addEventListener('input', () => {
    const len = text.value.length;
    if (counter) {
      counter.textContent = `${len} / 5000`;
      counter.classList.toggle('counter--warn', len >= 4500);
      counter.classList.toggle('counter--danger', len >= 4800);
    }
  });

  mediaInput?.addEventListener('change', () => {
    if (!preview) return;
    preview.innerHTML = '';
    const file = mediaInput.files?.[0];
    if (!file) {
      preview.hidden = true;
      if (quality) quality.hidden = true;
      return;
    }
    // The size switch only makes sense for a picture.
    if (quality) quality.hidden = !file.type.startsWith('image/');
    const url = URL.createObjectURL(file);
    let node;
    if (file.type.startsWith('video/')) {
      node = document.createElement('video');
      node.src = url;
      node.controls = true;
      node.muted = true;
    } else if (file.type.startsWith('image/')) {
      node = document.createElement('img');
      node.src = url;
      node.alt = t('Preview');
    } else {
      node = document.createElement('div');
      node.className = 'filebox';
      node.textContent = `${file.name} - ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    }
    preview.append(node);
    preview.hidden = false;
  });

  pinToggle?.addEventListener('click', () => {
    const type = typeInput?.value === 'emergency' ? 'emergency' : 'location';
    const isOpen = pinPanel ? !pinPanel.hidden : false;
    openPin(!isOpen);
    setType(!isOpen ? (type === 'emergency' ? 'emergency' : 'location') : 'text');
  });

  pollToggle?.addEventListener('click', () => {
    if (pollPanel) {
      pollPanel.hidden = !pollPanel.hidden;
      pollToggle.classList.toggle('is-on', !pollPanel.hidden);
    }
  });

  const pollAddBtn = $('[data-poll-add-option]', form);
  const pollOptionsWrap = $('[data-poll-options]', form);
  pollAddBtn?.addEventListener('click', () => {
    if (!pollOptionsWrap) return;
    const count = pollOptionsWrap.querySelectorAll('input[name="poll_option"]').length + 1;
    if (count > 8) return;
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.className = 'field__label';
    span.textContent = t('Option {n}', { n: count });
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'poll_option';
    input.maxLength = 80;
    input.placeholder = t('Option');
    label.append(span, input);
    pollOptionsWrap.append(label);
  });

  sosToggle?.addEventListener('click', () => {
    const active = typeInput?.value === 'emergency';
    setType(active ? 'text' : 'emergency');
    openPin(!active);
  });

  form.addEventListener('submit', (event) => {
    const type = typeInput?.value;
    const lat = form.querySelector('[data-pin-lat]')?.value;
    const lng = form.querySelector('[data-pin-lng]')?.value;
    if ((type === 'location' || type === 'emergency') && (!lat || !lng)) {
      event.preventDefault();
      openPin(true);
      flash(t('Drop a pin or use your GPS first.'), 'warning');
      return;
    }
    // A poll that is half filled used to be dropped without a word, which
    // looked like polls simply did not work.
    let pollReady = false;
    if (pollPanel && !pollPanel.hidden) {
      const question = form.querySelector('[name="poll_question"]')?.value.trim();
      const options = [...form.querySelectorAll('[name="poll_option"]')]
        .map((input) => input.value.trim())
        .filter(Boolean);
      if (question || options.length) {
        if (!question || options.length < 2) {
          event.preventDefault();
          flash(t('A poll needs a question and at least two options.'), 'warning');
          (question ? form.querySelector('[name="poll_option"]') : form.querySelector('[name="poll_question"]'))?.focus();
          return;
        }
        pollReady = true;
      }
    }
    // A poll is a post on its own - the "what happened" text is not needed.
    if (!text?.value.trim() && !mediaInput?.files?.length && type !== 'location' && type !== 'emergency' && !pollReady) {
      event.preventDefault();
      text?.focus();
      flash(t('Write something or attach a photo/video.'), 'warning');
    }
  });

  setType(typeInput?.value === 'emergency' ? 'emergency' : typeInput?.value === 'location' ? 'location' : 'text');
}

$$('[data-composer]').forEach(initComposer);
initSelectModals();

/* ── the phone number keeps its shape while it is typed ─────────── */
/**
 * A Georgian number is written the same way everywhere:
 * +995 and nine digits, in threes. The field formats it as the driver
 * types, so a number that cannot be dialled never gets typed at all.
 */
$$('[data-phone]').forEach((input) => {
  const format = (value) => {
    const digits = String(value || '').replace(/\D/g, '').replace(/^995/, '').slice(0, 9);
    if (!digits) return '';
    const groups = digits.match(/^(\d{0,3})(\d{0,3})(\d{0,3})$/);
    let out = '+995';
    if (groups[1]) out += ' ' + groups[1];
    if (groups[2]) out += ' ' + groups[2];
    if (groups[3]) out += ' ' + groups[3];
    return out;
  };
  // A number that is already in the right shape stays as it is, and a
  // value that is not a number at all is left alone - the mask must
  // never wipe what the driver typed.
  const current = input.value.trim();
  if (current && /\d/.test(current)) input.value = format(current);
  input.addEventListener('input', () => {
    const atEnd = input.selectionStart === input.value.length;
    input.value = format(input.value);
    if (atEnd) input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener('focus', () => {
    if (!input.value) input.value = '+995 ';
  });
  input.addEventListener('blur', () => {
    input.value = input.value.replace(/\s+$/, '');
  });
});

/* ── a chosen picture is shown before it is saved ───────────────── */
/**
 * Choosing a file shows it straight away, so the driver can see what
 * they picked before the form is sent. The picture is only really
 * saved when the form goes through - the ring around it says so.
 */
$$('[data-avatar-input]').forEach((input) => {
  const holder = input.dataset.avatarTarget
    ? document.querySelector(input.dataset.avatarTarget)
    : input.closest('[data-avatar-preview]');
  if (!holder) return;
  const current = holder.querySelector('[data-avatar-img]');
  if (!current) return;

  const note = input.closest('form')?.querySelector('[data-avatar-note]');
  const wasHidden = holder.hidden;
  let preview = null;
  let url = null;

  const stopPreview = () => {
    if (preview) { preview.replaceWith(current); preview = null; }
    if (url) { URL.revokeObjectURL(url); url = null; }
    holder.classList.remove('is-preview');
    holder.hidden = wasHidden;
    if (note) note.hidden = true;
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) { stopPreview(); return; }
    if (!file.type.startsWith('image/')) {
      flash(t('Please choose an image file.'));
      input.value = '';
      stopPreview();
      return;
    }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);

    const img = document.createElement('img');
    img.className = holder.dataset.avatarClass || '';
    img.alt = '';
    img.src = url;
    preview = img;
    current.replaceWith(img);
    holder.hidden = false;
    holder.classList.add('is-preview');
    if (note) note.hidden = false;
  });
});

/* ── composer: who can see the post ─────────────────────────────── */
$$('select[name="privacy"]').forEach((select) => {
  const note = select.closest('.composer__scope')?.querySelector('[data-privacy-note]');
  const update = () => {
    if (note) note.textContent = select.value === 'friends' ? t('only your friends can see it') : t('everyone can see it');
  };
  select.addEventListener('change', update);
  update();
});

/* ── password meter, visibility, username check ─────────────────── */
function scorePassword(value) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}

$$('[data-pw]').forEach((input) => {
  const meter = $('[data-pw-meter]', input.closest('form') || document);
  input.addEventListener('input', () => {
    if (meter) meter.dataset.score = String(scorePassword(input.value));
  });
});

$$('[data-pw-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = btn.closest('.field__pw')?.querySelector('input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-label', show ? t('Hide password') : t('Show password'));
  });
});

const usernameInput = $('[data-username-input]');
if (usernameInput) {
  const note = $('[data-username-note]');
  let timer;
  usernameInput.addEventListener('input', () => {
    clearTimeout(timer);
    const value = usernameInput.value.trim();
    if (!note) return;
    note.textContent = '';
    note.style.color = '';
    if (value.length < 3) return;

    timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/username-check?u=${encodeURIComponent(value)}`, { credentials: 'same-origin' });
        const data = await res.json();
        note.textContent = data.message || '';
        note.style.color = data.available ? 'var(--neon-3)' : '#ff9aa4';
      } catch {
        /* availability is a nicety, the server validates on submit */
      }
    }, 420);
  });
}

/* ── member counts / badge polling ──────────────────────────────── */
function updateBadge(key, value) {
  $$(`[data-badge="${key}"]`).forEach((el) => {
    if (value > 0) {
      el.hidden = false;
      el.textContent = value > 99 ? '99+' : String(value);
    } else {
      el.hidden = true;
    }
  });
  $$(`[data-badge-source="${key}"]`).forEach((el) => { el.dataset.value = String(value || 0); });
}

let baseTitle = document.title;
async function pulse() {
  if (!authed) return;
  try {
    const res = await fetch('/api/pulse', { credentials: 'same-origin', headers: { 'x-requested-with': 'fetch' } });
    if (!res.ok) return;
    const data = await res.json();
    updateBadge('chat', data.messages);
    updateBadge('notifications', data.notifications);
    updateBadge('friends', data.requests);

    const total = (data.messages || 0) + (data.notifications || 0);
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
  } catch {
    /* offline - try again on the next tick */
  }
}
if (authed) {
  setTimeout(pulse, 5000);
  setInterval(() => { if (!document.hidden) pulse(); }, 20000);
}

/* ── textarea growth ────────────────────────────────────────────── */
$$('textarea').forEach((area) => {
  const grow = () => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight + 2, 320)}px`;
  };
  area.addEventListener('input', grow);
  if (area.value) grow();
});

/* ── builds: weekly vote ────────────────────────────────────────── */
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-vote-form]');
  if (!form) return;
  event.preventDefault();

  const btn = $('[data-vote-btn]', form);
  const label = $('[data-vote-label]', form);
  const countEl = $('[data-vote-count]');
  const totalEl = $('[data-vote-total]');
  setBusy(btn, true);
  try {
    const data = await api(form.action, { body: new URLSearchParams(new FormData(form)) });
    btn.classList.toggle('btn--outline', data.voted);
    btn.classList.toggle('btn--primary', !data.voted);
    btn.classList.toggle('is-on', data.voted);
    btn.setAttribute('aria-pressed', String(data.voted));
    if (label) label.textContent = data.voted ? t('Voted this week') : t('Vote build of the week');
    if (countEl) countEl.textContent = data.weekVotes;
    if (totalEl) totalEl.textContent = data.votes;
    flash(data.voted ? (data.moved ? t('Vote moved to this build.') : t('Vote locked in for build of the week.')) : t('Vote withdrawn.'), 'success');
  } catch (error) {
    flash(error.message);
  } finally {
    setBusy(btn, false);
  }
});

/* ── builds: watch a car until it goes on sale ──────────────────── */
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-watch-form]');
  if (!form) return;
  event.preventDefault();

  const btn = $('[data-watch-btn]', form);
  if (!btn) return; // no watch button in this form
  const label = $('[data-watch-label]', form);
  setBusy(btn, true);
  try {
    const data = await api(form.action, { body: new URLSearchParams(new FormData(form)) });
    btn.classList.toggle('btn--outline', data.watching);
    btn.classList.toggle('btn--ghost', !data.watching);
    btn.classList.toggle('is-on', data.watching);
    btn.setAttribute('aria-pressed', String(data.watching));
    if (label) label.textContent = data.watching ? t('You are watching this car') : t('Notify me when it is for sale');
    flash(data.watching ? t('Noted. We will tell you when this car goes up for sale.') : t('This car is off your watch list.'), 'success');
  } catch (error) {
    flash(error.message);
  } finally {
    setBusy(btn, false);
  }
});

/* ── builds: gallery switcher ───────────────────────────────────── */const gallery = $('[data-gallery]');
if (gallery) {
  const slides = $$('[data-slide]', gallery);
  const thumbs = $$('[data-thumb]', gallery);
  const show = (index) => {
    slides.forEach((slide) => slide.classList.toggle('is-active', Number(slide.dataset.slide) === index));
    thumbs.forEach((thumb) => thumb.classList.toggle('is-active', Number(thumb.dataset.thumb) === index));
  };
  thumbs.forEach((thumb) => thumb.addEventListener('click', () => show(Number(thumb.dataset.thumb))));
}

/* ── builds: upload preview ─────────────────────────────────────── */
const buildMedia = $('[data-build-media]');
if (buildMedia) {
  const host = $('[data-build-preview]');
  buildMedia.addEventListener('change', () => {
    if (!host) return;
    host.innerHTML = '';
    const files = [...(buildMedia.files || [])];
    host.hidden = files.length === 0;
    files.slice(0, 8).forEach((file) => {
      const url = URL.createObjectURL(file);
      let node;
      if (file.type.startsWith('video/')) {
        node = document.createElement('video');
        node.src = url;
        node.muted = true;
        node.preload = 'metadata';
        node.playsInline = true;
      } else if (file.type.startsWith('image/')) {
        node = document.createElement('img');
        node.src = url;
        node.alt = t('Preview');
      } else {
        node = document.createElement('div');
        node.className = 'filebox';
        node.textContent = `${file.name} - ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      }
      host.append(node);
    });
  });
}

/* ── first-visit onboarding ─────────────────────────────────────── */
function initOnboarding() {
  const tip = document.querySelector('[data-onboarding]');
  if (!tip) return;
  if (localStorage.getItem('onboardingSeen')) {
    tip.remove();
    return;
  }
  tip.hidden = false;
  tip.querySelector('[data-onboarding-dismiss]')?.addEventListener('click', () => {
    tip.remove();
    localStorage.setItem('onboardingSeen', '1');
  });
  // The "How it works" button is now an anchor to /about.
  // Dismiss the tooltip when clicked.
  const tourLink = tip.querySelector('a[href="/about"]');
  if (tourLink) {
    tourLink.addEventListener('click', () => {
      tip.remove();
      localStorage.setItem('onboardingSeen', '1');
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnboarding);
} else {
  initOnboarding();
}
