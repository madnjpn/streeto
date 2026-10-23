/* ══════════════════════════════════════════════════════════════════
   STREETO — chat thread
   Polls for new messages, sends via fetch, keeps the scroll pinned.
   Falls back to a normal form post when fetch fails.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

const root = document.querySelector('[data-chat]');

if (root) {
  const conversationId = root.dataset.conversation;
  const feed = root.querySelector('[data-chat-feed]');
  const form = root.querySelector('[data-chat-form]');
  const input = root.querySelector('[data-chat-input]');
  const fileInput = root.querySelector('[data-chat-file]');
  const attachNote = root.querySelector('[data-chat-attach]');
  const status = root.querySelector('[data-chat-status]');
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const POLL_MS = 3000;

  let lastId = Number(root.dataset.lastId) || 0;
  let polling = null;

  const atBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;

  function scrollToBottom(force = false) {
    if (force || atBottom()) feed.scrollTop = feed.scrollHeight;
  }

  function appendMessages(messages, { mine = false } = {}) {
    if (!messages.length) return;
    root.querySelector('[data-chat-empty]')?.remove();
    messages.forEach((message) => {
      if (feed.querySelector(`[data-msg="${message.id}"]`)) return;
      feed.insertAdjacentHTML('beforeend', message.html);
      if (message.id > lastId) lastId = message.id;
    });
    scrollToBottom(mine);
  }

  async function poll() {
    if (document.hidden) return;
    try {
      const res = await fetch(`/chat/${conversationId}/messages?after=${lastId}`, {
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch' },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages?.length) {
        appendMessages(data.messages);
        if (!data.messages.some((m) => m.mine)) {
          status.hidden = false;
          status.textContent = data.messages.length === 1 ? '1 new message' : `${data.messages.length} new messages`;
          setTimeout(() => { status.hidden = true; }, 4000);
        }
      }
    } catch {
      /* transient network error - the next tick retries */
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    const file = fileInput?.files?.[0];
    if (!text && !file) return;

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;

    const payload = new FormData();
    payload.append('body', text);
    payload.append('_csrf', csrf);
    if (file) payload.append('media', file);

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: payload,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch', 'x-csrf-token': csrf },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || t('Message failed to send.'));

      appendMessages([data.message], { mine: true });
      input.value = '';
      if (fileInput) fileInput.value = '';
      if (attachNote) { attachNote.hidden = true; attachNote.textContent = ''; }
      scrollToBottom(true);
    } catch (error) {
      status.hidden = false;
      status.textContent = error.message;
      window.setTimeout(() => { status.hidden = true; }, 5000);
    } finally {
      if (submit) submit.disabled = false;
      input.focus();
    }
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!attachNote) return;
    attachNote.hidden = !file;
    attachNote.textContent = file ? t('Attached: {name} ({size} MB)', { name: file.name, size: (file.size / 1024 / 1024).toFixed(2) }) : '';
  });

  // Live search in chat: highlight all matching messages and cycle with NEXT button.
  const searchInput = root.querySelector('[data-chat-search]');
  if (searchInput) {
    const searchNav = searchInput.parentNode;
    const nextBtn = searchNav.querySelector('[data-search-next]');
    const countEl = searchNav.querySelector('[data-search-count]');

    let matches = [];
    let currentMatch = -1;

    const highlight = (q) => {
      feed.querySelectorAll('.msg--search-hit').forEach((el) => el.classList.remove('msg--search-hit'));
      feed.querySelectorAll('.msg--search-active').forEach((el) => el.classList.remove('msg--search-active'));
      matches = [];
      currentMatch = -1;
      if (!q) {
        searchNav.classList.remove('has-results');
        if (countEl) countEl.textContent = '';
        if (nextBtn) nextBtn.hidden = true;
        return;
      }
      const msgs = [...feed.querySelectorAll('[data-msg]')];
      msgs.forEach((m) => {
        if ((m.textContent || '').toLowerCase().includes(q)) {
          m.classList.add('msg--search-hit');
          matches.push(m);
        }
      });
      if (matches.length) {
        searchNav.classList.add('has-results');
        currentMatch = 0;
        updateNav();
      } else {
        searchNav.classList.remove('has-results');
        if (countEl) countEl.textContent = '0';
        if (nextBtn) nextBtn.hidden = true;
      }
    };

    const updateNav = () => {
      if (!matches.length) return;
      if (countEl) countEl.textContent = `${currentMatch + 1}/${matches.length}`;
      matches.forEach((m, i) => m.classList.toggle('msg--search-active', i === currentMatch));
      matches[currentMatch].scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Show NEXT button only when multiple matches
      if (nextBtn) nextBtn.hidden = matches.length <= 1;
    };

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (!matches.length || matches.length <= 1) return;
        currentMatch = (currentMatch + 1) % matches.length;
        updateNav();
      });
    }

    let searchTimer = 0;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim().toLowerCase();
      searchTimer = setTimeout(() => highlight(q), 200);
    });
  }

  // Show delete button on message click (admin only)
  if (document.body.dataset.authed === '1') {
    feed.addEventListener('click', (e) => {
      const bubble = e.target.closest('.msg__bubble');
      if (!bubble) return;
      const msg = bubble.closest('.msg');
      if (!msg) return;
      const delForm = msg.querySelector('.msg__delete');
      if (delForm) {
        // Toggle visibility
        const isVisible = delForm.style.display !== 'none';
        // Hide all other delete buttons
        feed.querySelectorAll('.msg__delete').forEach((f) => { f.style.display = 'none'; });
        if (!isVisible) delForm.style.display = 'inline-block';
      }
    });
  }

  // @mention autocomplete: show username suggestions when typing @
  const mentionPanel = document.createElement('div');
  mentionPanel.className = 'chatpanel__mention-panel';
  mentionPanel.hidden = true;
  // Insert inside the form so position: absolute works relative to it
  form.style.position = 'relative';
  form.insertBefore(mentionPanel, form.firstChild);

  let mentionTimer = 0;
  let mentionRequest = 0;
  let mentionItems = [];

  const closeMention = () => {
    mentionPanel.hidden = true;
    mentionPanel.replaceChildren();
    mentionItems = [];
  };

  const showMentionSuggestions = (query) => {
    clearTimeout(mentionTimer);
    const mine = ++mentionRequest;
    mentionTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          headers: { 'x-requested-with': 'fetch' },
          credentials: 'same-origin',
        });
        const data = await res.json();
        if (mine !== mentionRequest) return;
        const people = data.people ?? [];
        mentionPanel.replaceChildren();
        if (!people.length) { closeMention(); return; }
        people.slice(0, 6).forEach((p) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'chatpanel__mention-item';
          const img = p.avatar ? document.createElement('img') : null;
          if (img) {
            img.src = `/uploads/${encodeURIComponent(p.avatar)}`;
            img.alt = '';
            img.className = 'chatpanel__mention-avatar';
            btn.appendChild(img);
          }
          const name = document.createElement('span');
          name.className = 'chatpanel__mention-name';
          name.textContent = `@${p.username}`;
          btn.appendChild(name);
          if (p.displayName && p.displayName !== p.username) {
            const dn = document.createElement('span');
            dn.className = 'chatpanel__mention-display';
            dn.textContent = p.displayName;
            btn.appendChild(dn);
          }
          btn.addEventListener('click', () => {
            // Replace the @partial with @fullusername + space
            const val = input.value;
            const cursorPos = input.selectionStart;
            const beforeCursor = val.slice(0, cursorPos);
            const afterCursor = val.slice(cursorPos);
            // Find the last @ before cursor
            const atIdx = beforeCursor.lastIndexOf('@');
            if (atIdx >= 0) {
              const newVal = beforeCursor.slice(0, atIdx) + `@${p.username} ` + afterCursor;
              input.value = newVal;
              input.selectionStart = input.selectionEnd = atIdx + p.username.length + 2;
            }
            closeMention();
            input.focus();
          });
          mentionPanel.appendChild(btn);
        });
        mentionPanel.hidden = false;
      } catch {
        closeMention();
      }
    }, 150);
  };

  input?.addEventListener('input', () => {
    const val = input.value;
    const cursorPos = input.selectionStart;
    const beforeCursor = val.slice(0, cursorPos);
    // Check if we're typing after an @
    const atIdx = beforeCursor.lastIndexOf('@');
    if (atIdx >= 0) {
      const afterAt = beforeCursor.slice(atIdx + 1);
      // Only show suggestions if no space after @ (still typing the username)
      if (afterAt.length >= 1 && !afterAt.includes(' ') && !afterAt.includes('@')) {
        showMentionSuggestions(afterAt);
        return;
      }
    }
    closeMention();
  });

  // Close mention panel on blur or escape
  input?.addEventListener('blur', () => setTimeout(closeMention, 200));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMention();
  });

  // Keep the view pinned when the user is already at the bottom.
  scrollToBottom(true);
  polling = window.setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('beforeunload', () => window.clearInterval(polling));

  input?.focus({ preventScroll: true });
}
