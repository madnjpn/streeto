/* ══════════════════════════════════════════════════════════════════
   STREETO — floating chat box
   A launcher in the corner opens a panel that lists recent threads.
   Clicking a thread loads it in place with a quick-reply box, so new
   messages can be read and answered without leaving the page.
   Everything is built with DOM nodes, never parsed HTML from the
   network, except the server-rendered message bubbles we already trust
   (the same ones the chat page uses).
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { attachMentions } from './mentions.js';

/** The emojis a driver can press on a message. */
const REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '😮', '😢', '🙏'];

/** What each kind of shared thing is called, for the inbox line. */
const SHARE_LABELS = {
  build: 'build',
  post: 'Post',
  meetup: 'Meetup',
  part: 'Part',
  service: 'Service',
};

/** The earth, for the global channel. */
function globeIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '8.5');
  const lines = document.createElementNS(ns, 'path');
  lines.setAttribute('d', 'M3.5 12h17M12 3.5c2.4 2.6 3.4 5.5 3.4 8.5S14.4 18 12 20.5C9.6 18 8.6 15 8.6 12s1-5.9 3.4-8.5z');
  svg.append(circle, lines);
  return svg;
}

const root = document.querySelector('[data-chat-dock]');

if (root) {
  const launcher = root.querySelector('[data-dock-launcher]');
  const badge = root.querySelector('[data-dock-badge]');
  const panel = root.querySelector('[data-dock-panel]');
  const list = root.querySelector('[data-dock-list]');
  const thread = root.querySelector('[data-dock-thread]');
  const messages = root.querySelector('[data-dock-messages]');
  const form = root.querySelector('[data-dock-form]');
  const input = root.querySelector('[data-dock-input]');
  const titleEl = root.querySelector('[data-dock-title]');

  // @mention autocomplete: the same one the comment box uses.
  const minBtn = root.querySelector('[data-dock-min]');
  const minIcon = root.querySelector('[data-dock-icon="min"]');
  const maxIcon = root.querySelector('[data-dock-icon="max"]');
  const closeBtn = root.querySelector('[data-dock-close]');
  const titleBtn = root.querySelector('[data-dock-title]');
  const backBtn = root.querySelector('[data-dock-back]');
  const switchEl = root.querySelector('[data-dock-switch]');
  const replyBar = root.querySelector('[data-dock-replybar]');
  const replyName = root.querySelector('[data-dock-reply-name]');
  const parentField = root.querySelector('[data-dock-parent]');
  const attachBtn = root.querySelector('[data-dock-attach]');
  const fileInput = root.querySelector('[data-dock-file]');

  const uploadUrl = root.dataset.uploadUrl || '/uploads';
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const POLL_MS = 60000; // fallback only; realtime uses Socket.IO

  let socket = null;
  try {
    if (typeof window.io === 'function') {
      socket = window.io();
      socket.on('chat:message', (payload) => {
        // The chat the driver is looking at does not need a pointer to
        // itself - only another conversation is worth switching to.
        if (activeId && String(payload.conversationId) === String(activeId)) {
          pollThread();
        } else {
          const conversation = conversations.find((c) => String(c.id) === String(payload.conversationId));
          if (conversation) showIncoming(conversation);
        }
        refresh();
      });
      socket.on('chat:reaction', (payload) => {
        if (!payload || !activeId || String(payload.conversationId) !== String(activeId)) return;
        const messageEl = messages.querySelector(`[data-msg="${payload.messageId}"]`);
        if (!messageEl) return;
        // The bar is rebuilt from the server on the next poll; show the
        // change right away so it does not feel slow.
        const bar = messageEl.querySelector('[data-reacts]');
        if (!bar) return;
        const button = bar.querySelector(`[data-react="${payload.emoji}"]`);
        if (!button) {
          pollThread();
          return;
        }
        const count = button.querySelector('span:last-child');
        if (count) count.textContent = String(Math.max(0, Number(count.textContent) + (payload.added ? 1 : -1)));
      });
    }
  } catch (e) {
    socket = null;
  }

  let conversations = [];
  let open = false;
  let minimised = false;
  let activeId = null;
  let lastUnread = null;
  let lastMsgId = 0;
  /** A conversation that wrote to us while another one was open. */
  let incoming = null;

  /* ── helpers ──────────────────────────────────────────────────── */
  const request = (url, options = {}) =>
    fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'x-requested-with': 'fetch', ...(options.headers || {}) },
    });

  function timeAgo(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 60) return 'now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString();
  }

  function previewText(c) {
    if (c.lastBody) return c.lastMine ? `${t('You')}: ${c.lastBody}` : c.lastBody;
    if (c.lastShareType) {
      const what = t(SHARE_LABELS[c.lastShareType] || 'Post');
      const title = c.lastShareTitle ? ` ${c.lastShareTitle}` : '';
      return t('Shared: {what}', { what: `${what}${title}` });
    }
    if (c.lastMediaType === 'photo') return t('Photo');
    if (c.lastMediaType === 'video') return t('Clip');
    return t('No messages yet.');
  }

  function avatarNode(c) {
    // The global channel gets the earth, so it reads as the open pit lane.
    if (c.kind === 'global') {
      const span = document.createElement('span');
      span.className = 'chatdock__avatar chatdock__avatar--globe';
      span.appendChild(globeIcon());
      return span;
    }
    if (c.avatar) {
      const img = document.createElement('img');
      img.className = `chatdock__avatar${c.online ? ' is-online' : ''}`;
      img.src = `${uploadUrl}/${c.avatar}`;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    const span = document.createElement('span');
    span.className = `chatdock__avatar chatdock__avatar--gen${c.online ? ' is-online' : ''}`;
    span.textContent = (c.title || '?').trim().charAt(0).toUpperCase() || '?';
    return span;
  }

  function rowNode(c) {
    const wrap = document.createElement('div');
    wrap.className = 'chatdock__rowwrap';

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `chatdock__row${c.unread ? ' is-unread' : ''}${c.kind === 'global' ? ' chatdock__row--global' : ''}`;
    row.append(avatarNode(c));

    const text = document.createElement('div');
    text.className = 'chatdock__rowtext';

    const top = document.createElement('div');
    top.className = 'chatdock__rowtop';
    const name = document.createElement('strong');
    name.textContent = c.title;
    const time = document.createElement('time');
    time.textContent = timeAgo(c.lastAt);
    top.append(name, time);

    const preview = document.createElement('div');
    preview.className = 'chatdock__preview';
    preview.textContent = previewText(c);

    text.append(top, preview);
    row.append(text);

    if (c.unread) {
      const pip = document.createElement('span');
      pip.className = 'pip';
      pip.textContent = c.unread > 9 ? '9+' : String(c.unread);
      row.append(pip);
    }

    // Delete button (revealed by swipe)
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chatdock__rowdelete';
    del.textContent = t('Delete');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('Remove this conversation from your inbox?'))) return;
      try {
        const res = await fetch(`/chat/${c.id}/delete`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-requested-with': 'fetch', 'x-csrf-token': csrf },
        });
        if (res.ok) {
          wrap.remove();
          conversations = conversations.filter((x) => x.id !== c.id);
          renderList();
        }
      } catch {}
    });

    wrap.append(row, del);

    // Swipe to reveal delete (touch + mouse)
    let startX = 0, startY = 0, moved = false, dragging = false;
    const clamp = (dx) => Math.max(-80, dx);
    const apply = (dx) => { row.style.transform = `translateX(${clamp(dx)}px)`; };
    const finish = () => {
      row.style.transition = 'transform 0.2s ease';
      const val = parseInt((row.style.transform.replace(/[^-0-9]/g, '')) || 0);
      if (moved && val < -40) {
        row.style.transform = 'translateX(-80px)';
        wrap.classList.add('is-swiped');
      } else {
        row.style.transform = '';
        wrap.classList.remove('is-swiped');
      }
      moved = false;
      dragging = false;
    };
    const onDown = (clientX, clientY) => {
      startX = clientX; startY = clientY; moved = false; dragging = true;
      row.style.transition = 'none';
    };
    const onMove = (clientX, clientY) => {
      if (!dragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (dx > 0) return; // only swipe left
      moved = true;
      apply(dx);
    };
    const onUp = () => {
      if (!dragging) return;
      finish();
    };
    // Touch
    row.addEventListener('touchstart', (e) => onDown(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    row.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    row.addEventListener('touchend', onUp, { passive: true });
    row.addEventListener('touchcancel', onUp, { passive: true });
    // Mouse (desktop)
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      onDown(e.clientX, e.clientY);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY), { passive: true });
    window.addEventListener('mouseup', onUp);

    row.addEventListener('click', () => {
      // If swiped open, close it instead of opening thread
      if (row.style.transform && row.style.transform !== '') {
        row.style.transform = '';
        wrap.classList.remove('is-swiped');
        return;
      }
      openThread(c);
    });

    return wrap;
  }

  /* ── reactions ─────────────────────────────────────────────────── */
  /** The little emoji strip that opens on a long press. */
  let picker = null;

  function hidePicker() {
    if (!picker) return;
    picker.remove();
    picker = null;
  }

  function showPicker(messageEl) {
    hidePicker();
    // The picker is built after this click has finished, otherwise the
    // "click outside closes it" handler would close it again straight
    // away.
    setTimeout(() => {
      const box = document.createElement('div');
      box.className = 'reactpicker';
      REACTIONS.forEach((emoji) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = emoji;
        button.addEventListener('click', () => {
          react(messageEl, emoji);
          hidePicker();
        });
        box.appendChild(button);
      });
      document.body.appendChild(box);
      const rect = messageEl.getBoundingClientRect();
      const area = messages.getBoundingClientRect();
      const width = box.offsetWidth || 220;
      // Keep the strip next to the message, but inside the message area.
      const top = Math.min(Math.max(rect.top - 48, area.top + 8), Math.max(area.top + 8, area.bottom - 56));
      const left = Math.min(Math.max(rect.left, area.left + 8), Math.max(area.left + 8, area.right - width - 8));
      box.style.top = `${top}px`;
      box.style.left = `${left}px`;
      picker = box;
    }, 0);
  }

  /** Rebuild the reaction bar under a message. */
  function renderReactions(messageEl, list) {
    const bar = messageEl.querySelector('[data-reacts]');
    if (!bar) return;
    bar.replaceChildren();
    (list || []).forEach((r) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `react${r.mine ? ' is-mine' : ''}`;
      button.setAttribute('data-react', r.emoji);
      button.title = (r.who || []).map((w) => `@${w.username}`).join(', ');
      const emoji = document.createElement('span');
      emoji.textContent = r.emoji;
      const count = document.createElement('span');
      count.textContent = String(r.count);
      button.append(emoji, count);
      bar.appendChild(button);
    });
  }

  async function react(messageEl, emoji) {
    const id = messageEl?.dataset?.msg;
    if (!id || !activeId) return;
    try {
      const res = await fetch(`/chat/${activeId}/message/${id}/react`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'fetch',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({ emoji }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Message failed to send.'));
      renderReactions(messageEl, data.reactions || []);
    } catch (error) {
      const note = document.createElement('p');
      note.className = 'chatdock__error';
      note.textContent = error.message;
      thread.append(note);
      setTimeout(() => note.remove(), 5000);
    }
  }

  /* ── replying to a message ─────────────────────────────────────── */
  let replyTo = null;

  function setReplyTarget(messageEl, name) {
    replyTo = { id: messageEl?.dataset?.msg || null, name };
    // The field travels with the message, so the server knows what it
    // answers.
    if (parentField) parentField.value = replyTo.id || '';
    if (!replyBar) return;
    if (!replyTo.id) {
      replyBar.hidden = true;
      return;
    }
    if (replyName) replyName.textContent = `${t('Replying to')} ${name || ''}`;
    replyBar.hidden = false;
    input?.focus({ preventScroll: true });
  }

  function renderList() {
    list.replaceChildren();
    if (!conversations.length) {
      const hint = document.createElement('p');
      hint.className = 'chatdock__hint muted';
      hint.textContent = t('No chats yet.');
      list.append(hint);
      return;
    }
    conversations.forEach((c) => list.append(rowNode(c)));
  }

  function setBadge(count) {
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 99 ? '99+' : String(count);
      root.classList.add('has-unread');
    } else {
      badge.hidden = true;
      root.classList.remove('has-unread');
    }
    // Keep the header nav badge in step without waiting for the pulse.
    document.querySelectorAll('[data-badge="chat"]').forEach((el) => {
      if (count > 0) {
        el.hidden = false;
        el.textContent = count > 9 ? '9+' : String(count);
      } else {
        el.hidden = true;
      }
    });
  }

  /* ── open / minimise / close ──────────────────────────────────── */
  function setOpen(value) {
    open = value;
    panel.hidden = !value;
    launcher.setAttribute('aria-expanded', String(value));
    if (value && minimised) setMinimised(false);
    // Lock body scroll on mobile when chat is fully open (not minimised)
    if (value && !minimised && window.innerWidth <= 640) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
  }

  /**
   * The header depends on two things: whether a thread is open, and
   * whether the window is minimised. The back button and the little
   * "somebody wrote to you" avatar both disappear when the window is
   * minimised - there is no room for them, and the title restores it.
   */
  function updateHead() {
    const visible = Boolean(activeId) && !minimised;
    if (backBtn) backBtn.hidden = !visible;
    if (switchEl) switchEl.hidden = !visible || !incoming;
    if (titleBtn) {
      titleBtn.title = minimised ? t('Maximise') : (activeId ? t('Back to chats') : t('Chat'));
    }
  }

  /** Show the sender's picture with a red dot, to switch to that chat. */
  function showIncoming(conversation) {
    if (!conversation) return;
    incoming = conversation;
    if (!switchEl) return;
    switchEl.replaceChildren();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chatdock__switch-btn';
    button.title = conversation.title || t('Chat');
    button.setAttribute('aria-label', `${conversation.title || t('Chat')} - ${t('New message')}`);
    button.append(avatarNode(conversation));
    button.addEventListener('click', () => {
      incoming = null;
      switchEl.replaceChildren();
      openThread(conversation);
    });
    switchEl.append(button);
    updateHead();
  }

  function setMinimised(value) {
    minimised = value;
    root.classList.toggle('is-min', value);
    // The button shows what it will do: minimise when the window is
    // open, restore it when the window is small.
    if (minIcon) minIcon.hidden = value;
    if (maxIcon) maxIcon.hidden = !value;
    if (minBtn) {
      minBtn.setAttribute('aria-label', value ? t('Maximise') : t('Minimise'));
      minBtn.title = value ? t('Maximise') : t('Minimise');
    }
    // Re-evaluate body scroll lock when minimised state changes
    if (open && window.innerWidth <= 640) {
      if (value) {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
      } else {
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
      }
    }
    updateHead();
  }

  function showList() {
    activeId = null;
    incoming = null;
    thread.hidden = true;
    list.hidden = false;
    titleEl.textContent = t('Chat');
    if (switchEl) { switchEl.replaceChildren(); }
    updateHead();
    renderList();
  }

  /* ── threads ──────────────────────────────────────────────────── */
  function appendMessage(message) {
    if (messages.querySelector(`[data-msg="${message.id}"]`)) return;
    messages.insertAdjacentHTML('beforeend', message.html);
    if (message.id > lastMsgId) lastMsgId = message.id;
  }

  async function openThread(conversation) {
    activeId = conversation.id;
    lastMsgId = 0;
    messages.replaceChildren();
    titleEl.textContent = conversation.title || t('Chat');
    list.hidden = true;
    thread.hidden = false;
    // The little "somebody wrote to you" picture belongs to another
    // chat, so it goes away once that chat is open.
    incoming = null;
    if (switchEl) switchEl.replaceChildren();
    updateHead();
    setOpen(true);

    try {
      const res = await request(`/chat/${conversation.id}/messages`);
      const data = await res.json();
      (data.messages || []).forEach(appendMessage);
      messages.scrollTop = messages.scrollHeight;
      refresh();
    } catch {
      /* the next poll retries */
    }
    input?.focus({ preventScroll: true });
  }

  async function pollThread() {
    if (!activeId) return;
    try {
      const res = await request(`/chat/${activeId}/messages?after=${lastMsgId}`);
      const data = await res.json();
      const fresh = data.messages || [];
      if (!fresh.length) return;
      const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
      fresh.forEach(appendMessage);
      if (atBottom) messages.scrollTop = messages.scrollHeight;
    } catch {
      /* transient */
    }
  }

  input?.addEventListener('input', () => {
    if (!socket || !activeId) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (conv && conv.otherId) socket.emit('typing', { conversationId: activeId, to: conv.otherId });
  });

  // The @mention autocomplete is the same one the comment box uses.
  attachMentions(input);

  // When the keyboard comes up, keep the newest message in sight.
  input?.addEventListener('focus', () => {
    setTimeout(() => {
      syncKeyboard();
      messages.scrollTop = messages.scrollHeight;
    }, 150);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeId) return;
    const body = input.value.trim();
    const file = fileInput?.files?.[0] || null;
    if (!body && !file) return;

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;

    try {
      const payload = new FormData();
      payload.append('body', body);
      payload.append('_csrf', csrf);
      if (parentField && parentField.value) payload.append('parent_id', parentField.value);
      if (file) payload.append('media', file);
      const res = await fetch(`/chat/${activeId}/send`, {
        method: 'POST',
        body: payload,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch', 'x-csrf-token': csrf },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || t('Message failed to send.'));
      appendMessage(data.message);
      input.value = '';
      if (fileInput) fileInput.value = '';
      // The file is on its way, so the attachment bar has nothing to say.
      showAttachment();
      setReplyTarget(null);
      messages.scrollTop = messages.scrollHeight;
      refresh();
    } catch (error) {
      const note = document.createElement('p');
      note.className = 'chatdock__error';
      note.textContent = error.message;
      thread.append(note);
      setTimeout(() => note.remove(), 5000);
    } finally {
      if (submit) submit.disabled = false;
      input.focus();
    }
  });

  /* ── attach a file ─────────────────────────────────────────────── */
  const attachBar = root.querySelector('[data-dock-attachbar]');
  const attachName = root.querySelector('[data-dock-attach-name]');
  const quality = root.querySelector('[data-quality]');
  const qualityInput = root.querySelector('[data-quality-input]');

  /* A picture can be small and quick, or full size. */
  quality?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quality-value]');
    if (!button) return;
    const value = button.dataset.qualityValue === 'hd' ? 'hd' : 'sd';
    if (qualityInput) qualityInput.value = value;
    quality.querySelectorAll('[data-quality-value]').forEach((btn) => {
      btn.classList.toggle('is-on', btn === button);
    });
  });

  const showAttachment = () => {
    const file = fileInput?.files?.[0];
    if (!file) {
      if (attachBar) attachBar.hidden = true;
      if (quality) quality.hidden = true;
      return;
    }
    const size = file.size ? ` · ${Math.max(1, Math.round(file.size / 1024))} KB` : '';
    if (attachName) attachName.textContent = `${file.name}${size}`;
    if (attachBar) attachBar.hidden = false;
    // The size switch only makes sense for a picture.
    if (quality) quality.hidden = !file.type.startsWith('image/');
  };

  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    showAttachment();
    input?.focus({ preventScroll: true });
  });
  root.querySelector('[data-dock-attach-remove]')?.addEventListener('click', () => {
    if (fileInput) fileInput.value = '';
    showAttachment();
    input?.focus({ preventScroll: true });
  });

  /* ── react to a message: long press, or right click ────────────── */
  let pressTimer = 0;
  let pressed = null;

  const startPress = (messageEl) => {
    pressed = messageEl;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (pressed) showPicker(pressed);
      pressed = null;
    }, 480);
  };
  const endPress = () => {
    clearTimeout(pressTimer);
    pressed = null;
  };

  messages?.addEventListener('touchstart', (event) => {
    const messageEl = event.target.closest('.msg');
    if (messageEl) startPress(messageEl);
  }, { passive: true });
  messages?.addEventListener('touchend', endPress, { passive: true });
  messages?.addEventListener('touchcancel', endPress, { passive: true });
  messages?.addEventListener('touchmove', endPress, { passive: true });
  messages?.addEventListener('contextmenu', (event) => {
    const messageEl = event.target.closest('.msg');
    if (!messageEl) return;
    event.preventDefault();
    showPicker(messageEl);
  });

  /* ── swipe a message to reply to it ────────────────────────────── */
  let swipe = null;
  messages?.addEventListener('touchstart', (event) => {
    const messageEl = event.target.closest('.msg');
    if (!messageEl) return;
    const touch = event.touches[0];
    swipe = { x: touch.clientX, y: touch.clientY, msg: messageEl, done: false };
  }, { passive: true });
  messages?.addEventListener('touchmove', (event) => {
    if (!swipe || swipe.done) return;
    const touch = event.touches[0];
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swipe.done = true;
      const button = swipe.msg.querySelector('[data-msg-reply]');
      setReplyTarget(swipe.msg, button?.dataset.msgReplyName || '');
    }
  }, { passive: true });
  messages?.addEventListener('touchend', () => { swipe = null; }, { passive: true });

  // The reply button under a message.
  messages?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-msg-reply]');
    if (!button) return;
    event.preventDefault();
    const messageEl = button.closest('.msg');
    setReplyTarget(messageEl, button.dataset.msgReplyName || '');
  });

  // The small heart under a message opens the reaction strip - on a
  // desktop there is no long press to do it with.
  messages?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-msg-react]');
    if (!button) return;
    event.preventDefault();
    const messageEl = button.closest('.msg');
    if (messageEl) showPicker(messageEl);
  });

  // Edit a message you wrote.
  messages?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-msg-edit]');
    if (!button) return;
    event.preventDefault();
    const messageEl = button.closest('.msg');
    const form = messageEl?.querySelector('[data-edit-form]');
    const bubble = messageEl?.querySelector('.msg__bubble');
    if (!form || !bubble) return;
    bubble.hidden = true;
    form.hidden = false;
    const area = form.querySelector('[data-edit-text]');
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  });

  messages?.addEventListener('click', (event) => {
    const cancel = event.target.closest('[data-edit-cancel]');
    if (!cancel) return;
    event.preventDefault();
    const form = cancel.closest('[data-edit-form]');
    const messageEl = form?.closest('.msg');
    if (form) form.hidden = true;
    const bubble = messageEl?.querySelector('.msg__bubble');
    if (bubble) bubble.hidden = false;
  });

  messages?.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-edit-form]');
    if (!form) return;
    event.preventDefault();
    const id = form.dataset.editForm;
    const area = form.querySelector('[data-edit-text]');
    const body = area.value.trim();
    if (!body) return;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const res = await fetch(`/chat/${activeId}/message/${id}/edit`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'fetch',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || t('Message failed to send.'));
      const messageEl = messages.querySelector(`[data-msg="${id}"]`);
      if (messageEl) {
        messageEl.outerHTML = data.message.html;
      }
    } catch (error) {
      const note = document.createElement('p');
      note.className = 'chatdock__error';
      note.textContent = error.message;
      thread.append(note);
      setTimeout(() => note.remove(), 5000);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  // Somebody changed a message while you were looking at it.
  socket?.on('chat:edit', (payload) => {
    if (!payload || !activeId || String(payload.conversationId) !== String(activeId)) return;
    const messageEl = messages.querySelector(`[data-msg="${payload.messageId}"]`);
    const text = messageEl?.querySelector('.msg__text');
    if (text) text.textContent = payload.body || '';
  });

  // Press an existing reaction again to take it back.
  messages?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-react]');
    if (!button) return;
    event.preventDefault();
    react(button.closest('.msg'), button.dataset.react);
  });

  root.querySelector('[data-dock-reply-cancel]')?.addEventListener('click', () => setReplyTarget(null));
  document.addEventListener('click', (event) => {
    // The button that opens the picker is not a click "outside" it.
    if (event.target.closest('[data-msg-react]')) return;
    if (picker && !event.target.closest('.reactpicker')) hidePicker();
  });

  /* ── the phone keyboard ────────────────────────────────────────── */
  /* On a phone the on-screen keyboard covers the bottom of the page.
     The visual viewport knows how much room is really left, so the chat
     window is lifted up and made shorter to sit above the keyboard. */
  function syncKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', `${inset}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.classList.toggle('is-keyboard', inset > 80);
    if (inset > 80 && activeId) messages.scrollTop = messages.scrollHeight;
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncKeyboard);
    window.visualViewport.addEventListener('scroll', syncKeyboard);
  }
  window.addEventListener('orientationchange', () => setTimeout(syncKeyboard, 300));
  window.addEventListener('resize', syncKeyboard);
  window.addEventListener('resize', () => {
    if (!open && window.innerWidth > 640) {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
  });
  syncKeyboard();

  /* ── polling ──────────────────────────────────────────────────── */
  async function refresh() {
    try {
      const res = await request('/api/chat/dock');
      if (!res.ok) return;
      const data = await res.json();

      conversations = data.conversations || [];
      const unread = data.unread || 0;
      const grew = lastUnread !== null && unread > lastUnread;
      lastUnread = unread;
      setBadge(unread);

      if (grew) {
        root.classList.add('is-ping');
        setTimeout(() => root.classList.remove('is-ping'), 1600);
        if (!open && !document.hidden) setOpen(true);
      }

      if (activeId) await pollThread();
      else renderList();
    } catch {
      /* offline - try again on the next tick */
    }
  }

  launcher?.addEventListener('click', () => setOpen(!open));
  minBtn?.addEventListener('click', () => setMinimised(!minimised));
  closeBtn?.addEventListener('click', () => { setOpen(false); showList(); });
  backBtn?.addEventListener('click', showList);
  // The title restores a minimised window, and goes back to the list
  // when a thread is open.
  titleBtn?.addEventListener('click', () => {
    if (minimised) { setMinimised(false); setOpen(true); return; }
    if (activeId) showList();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open && !minimised) setOpen(false);
  });

  // The chat links in the menu open the dock where you already are,
  // instead of sending you to another page.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href="/chat"], a[href="/?chat=1"]');
    if (!link) return;
    event.preventDefault();
    setOpen(true);
  });

  /* ── opening from a link ───────────────────────────────────────── */
  // /chat and a chat link now open the dock, so a link like
  // /?chat=12 opens the dock straight into that thread.
  async function openFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('chat');
    if (wanted === null) return;
    // Take the flag out of the address bar so a reload does not reopen it.
    params.delete('chat');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
    await refresh();
    if (wanted === '1') { setOpen(true); return; }
    let conversation = conversations.find((c) => String(c.id) === String(wanted));
    if (!conversation) {
      // A conversation that was just started has no messages yet, so it
      // is not in the list - ask the server for it by id.
      try {
        const res = await request(`/api/chat/dock?id=${encodeURIComponent(wanted)}`);
        const data = await res.json();
        conversation = data.conversation || null;
      } catch {
        conversation = null;
      }
    }
    if (conversation) await openThread(conversation);
    else setOpen(true);
  }

  // Close mention panel on blur or escape
  input?.addEventListener('blur', () => setTimeout(closeMention, 200));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMention();
  });

  // A small handle for the rest of the page: the share picker hands a
  // thing over and wants the thread straight away.
  window.StreetoChat = {
    async openConversation(id) {
      const wanted = String(id);
      let conversation = conversations.find((c) => String(c.id) === wanted);
      if (!conversation) {
        // A conversation that was just started has no messages yet, so it
        // is not in the list - ask the server for it by id.
        try {
          const res = await request(`/api/chat/dock?id=${encodeURIComponent(wanted)}`);
          const data = await res.json();
          conversation = data.conversation || null;
        } catch {
          conversation = null;
        }
      }
      if (conversation) {
        await openThread(conversation);
        return true;
      }
      setOpen(true);
      return false;
    },
  };

  refresh().then(openFromUrl);
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
