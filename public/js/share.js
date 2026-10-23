/* ══════════════════════════════════════════════════════════════════
   STREETO — share a thing in a chat
   A build, a post, a meetup, a part or a service can be handed to
   another driver. The picker lists the chats that already exist and
   can find any other driver; the card itself is built on the server,
   so what is shared is always the real thing.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

const dialog = document.getElementById('share-dialog');

if (dialog) {
  const list = dialog.querySelector('[data-share-list]');
  const titleEl = dialog.querySelector('[data-share-title]');
  const labelEl = dialog.querySelector('[data-share-label]');
  const search = dialog.querySelector('[data-share-search]');
  const note = dialog.querySelector('[data-share-note]');

  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const uploadUrl = document.querySelector('[data-chat-dock]')?.dataset.uploadUrl || '/uploads';

  /** What is being shared, and who it goes to. */
  let current = null;
  let timer = 0;

  const openDialog = (node) => {
    if (typeof node.showModal === 'function') {
      if (!node.open) node.showModal();
    } else {
      node.setAttribute('open', '');
    }
  };

  /* ── the rows ─────────────────────────────────────────────────── */

  function avatarNode(person) {
    if (person.avatar) {
      const img = document.createElement('img');
      img.className = 'sharepick__avatar';
      img.src = `${uploadUrl}/${person.avatar}`;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    const span = document.createElement('span');
    span.className = 'sharepick__avatar sharepick__avatar--gen';
    span.textContent = (person.title || person.username || '?').trim().charAt(0).toUpperCase() || '?';
    return span;
  }

  function rowNode(person, username) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sharepick__row';
    row.append(avatarNode(person));

    const text = document.createElement('div');
    text.className = 'sharepick__rowtext';
    const name = document.createElement('strong');
    name.textContent = person.title || person.username;
    const sub = document.createElement('span');
    sub.className = 'muted small';
    sub.textContent = username ? `@${username}` : (person.car || person.city || '');
    text.append(name, sub);
    row.append(text);

    row.addEventListener('click', () => share(username || person.username));
    return row;
  }

  function renderRows(people, emptyText) {
    list.replaceChildren();
    if (!people.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = emptyText;
      list.append(p);
      return;
    }
    for (const person of people) list.append(rowNode(person, person.username));
  }

  /* ── the list of chats ────────────────────────────────────────── */

  async function loadChats() {
    try {
      const res = await fetch('/api/chat/dock', {
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch' },
      });
      if (!res.ok) return;
      const data = await res.json();
      const chats = (data.conversations || []).filter((c) => c.kind === 'global' || c.username);
      renderRows(
        chats.map((c) => ({
          title: c.kind === 'global' ? (c.title || 'Global channel') : c.title,
          username: c.kind === 'global' ? '__global__' : c.username,
          avatar: c.avatar,
          car: c.car,
          kind: c.kind,
        })),
        t('No chats yet. Find a driver below.'),
      );
    } catch {
      renderRows([], t('No chats yet. Find a driver below.'));
    }
  }

  async function loadGroups() {
    try {
      const res = await fetch('/api/groups/mine', {
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch' },
      });
      if (!res.ok) return;
      const data = await res.json();
      const groupList = data.groups || [];
      if (!groupList.length) return;
      // Add a section header
      const header = document.createElement('p');
      header.className = 'sharepick__section muted small';
      header.textContent = t('Groups');
      list.append(header);
      for (const g of groupList) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'sharepick__row';
        if (g.avatar) {
          const img = document.createElement('img');
          img.className = 'sharepick__avatar';
          img.src = `${uploadUrl}/${g.avatar}`;
          img.alt = '';
          img.loading = 'lazy';
          row.append(img);
        } else {
          const span = document.createElement('span');
          span.className = 'sharepick__avatar sharepick__avatar--gen';
          span.textContent = (g.name || '?').trim().charAt(0).toUpperCase() || '?';
          row.append(span);
        }
        const text = document.createElement('div');
        text.className = 'sharepick__rowtext';
        const name = document.createElement('strong');
        name.textContent = g.name;
        const sub = document.createElement('span');
        sub.className = 'muted small';
        sub.textContent = t('Post to group');
        text.append(name, sub);
        row.append(text);
        row.addEventListener('click', () => shareToGroup(g.slug));
        list.append(row);
      }
    } catch {
      // groups not available
    }
  }

  async function searchDrivers(query) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch' },
      });
      if (!res.ok) return;
      const data = await res.json();
      renderRows(
        (data.people || []).map((person) => ({
          title: person.displayName || person.username,
          username: person.username,
          avatar: person.avatar,
          car: person.car,
          city: person.city,
        })),
        t('Nobody found with that name.'),
      );
    } catch {
      renderRows([], t('Nobody found with that name.'));
    }
  }

  /* ── sharing ──────────────────────────────────────────────────── */

  async function share(username) {
    if (!current || !username) return;
    const buttons = list.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });

    try {
      const payload = new URLSearchParams();
      payload.append('type', current.type);
      payload.append('id', String(current.id));
      payload.append('username', username);
      payload.append('note', (note?.value || '').trim());
      payload.append('_csrf', csrf);

      const res = await fetch('/share', {
        method: 'POST',
        body: payload,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch', 'x-csrf-token': csrf },
      });
      const data = await res.json().catch(() => ({ ok: false, error: t('Could not share that.') }));
      if (!res.ok || !data.ok) throw new Error(data.error || t('Could not share that.'));

      dialog.close();
      if (note) note.value = '';
      // Show the thread the thing was handed over in.
      if (window.StreetoChat?.openConversation) {
        await window.StreetoChat.openConversation(data.conversationId);
      } else {
        location.href = `/?chat=${data.conversationId}`;
      }
    } catch (error) {
      const p = document.createElement('p');
      p.className = 'sharepick__error';
      p.textContent = error.message;
      list.prepend(p);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  async function shareToGroup(slug) {
    if (!current) return;
    const buttons = list.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });

    try {
      const payload = new URLSearchParams();
      payload.append('type', current.type);
      payload.append('id', String(current.id));
      payload.append('group', slug);
      payload.append('note', (note?.value || '').trim());
      payload.append('_csrf', csrf);

      const res = await fetch('/groups/share', {
        method: 'POST',
        body: payload,
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch', 'x-csrf-token': csrf },
      });
      const data = await res.json().catch(() => ({ ok: false, error: t('Could not share that.') }));
      if (!res.ok || !data.ok) throw new Error(data.error || t('Could not share that.'));

      dialog.close();
      if (note) note.value = '';
      location.href = `/groups/${slug}`;
    } catch (error) {
      const p = document.createElement('p');
      p.className = 'sharepick__error';
      p.textContent = error.message;
      list.prepend(p);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-share]');
    if (!button) return;
    event.preventDefault();
    current = {
      type: button.dataset.share,
      id: button.dataset.shareId,
      title: button.dataset.shareTitle || '',
      label: button.dataset.shareLabel || '',
    };
    if (titleEl) titleEl.textContent = current.title;
    if (labelEl) labelEl.textContent = current.label;
    if (note) note.value = '';
    if (search) search.value = '';
    openDialog(dialog);
    loadChats();
    loadGroups();
    setTimeout(() => search?.focus({ preventScroll: true }), 60);
  });

  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  search?.addEventListener('input', () => {
    clearTimeout(timer);
    const query = search.value.trim();
    if (!query) { loadChats(); return; }
    timer = setTimeout(() => searchDrivers(query), 220);
  });
}
