/* ══════════════════════════════════════════════════════════════════
   STREETO — @mention autocomplete
   Shared by the comment box and the chat box: type @ and the drivers
   who match are offered, and picking one puts the name in the field.
   The panel is built from DOM nodes, never from parsed HTML.
   ══════════════════════════════════════════════════════════════════ */

/**
 * Attach the autocomplete to a text field.
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 * @returns {{ close: Function, panel: HTMLElement }}
 */
export function attachMentions(input) {
  if (!input) return null;

  const panel = document.createElement('div');
  panel.className = 'mentionbox';
  panel.hidden = true;
  const host = input.parentElement;
  if (host) {
    host.style.position = 'relative';
    host.appendChild(panel);
  }

  let timer = 0;
  let request = 0;

  const close = () => {
    panel.hidden = true;
    panel.replaceChildren();
  };

  const pick = (name) => {
    const value = input.value;
    const cursor = input.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const at = before.lastIndexOf('@');
    if (at >= 0) {
      const next = before.slice(0, at) + `@${name} ` + value.slice(cursor);
      input.value = next;
      input.selectionStart = input.selectionEnd = at + name.length + 2;
    }
    close();
    input.focus();
  };

  const show = (query) => {
    clearTimeout(timer);
    const mine = ++request;
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          headers: { 'x-requested-with': 'fetch' },
          credentials: 'same-origin',
        });
        const data = await res.json();
        if (mine !== request) return;
        const people = data.people ?? [];
        panel.replaceChildren();
        if (!people.length) { close(); return; }
        people.slice(0, 6).forEach((person) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mentionbox__item';
          if (person.avatar) {
            const img = document.createElement('img');
            img.src = `/uploads/${encodeURIComponent(person.avatar)}`;
            img.alt = '';
            img.className = 'mentionbox__avatar';
            btn.appendChild(img);
          }
          const name = document.createElement('span');
          name.className = 'mentionbox__name';
          name.textContent = `@${person.username}`;
          btn.appendChild(name);
          if (person.displayName && person.displayName !== person.username) {
            const dn = document.createElement('span');
            dn.className = 'mentionbox__display';
            dn.textContent = person.displayName;
            btn.appendChild(dn);
          }
          btn.addEventListener('click', () => pick(person.username));
          panel.appendChild(btn);
        });
        panel.hidden = false;
      } catch {
        close();
      }
    }, 150);
  };

  input.addEventListener('input', () => {
    const value = input.value;
    const cursor = input.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const at = before.lastIndexOf('@');
    if (at >= 0) {
      const after = before.slice(at + 1);
      if (after.length >= 1 && !after.includes(' ') && !after.includes('@')) {
        show(after);
        return;
      }
    }
    close();
  });

  input.addEventListener('blur', () => setTimeout(close, 200));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  return { close, panel };
}

export default { attachMentions };
