/* ══════════════════════════════════════════════════════════════════
   STREETO — live search
   Whatever the driver types into a search box, show matches right
   under it: drivers, groups, meetups, builds, parts and services.
   Plain fetch + DOM building, so nothing from the network is ever
   parsed as HTML.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 180;

const make = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const initial = (label) => (String(label || '?').trim()[0] || '?').toUpperCase();

function thumb(label, image) {
  if (image) {
    const img = document.createElement('img');
    img.className = 'searchlive__thumb';
    img.src = `/uploads/${encodeURIComponent(image)}`;
    img.alt = '';
    img.loading = 'lazy';
    return img;
  }
  return make('span', 'searchlive__thumb', initial(label));
}

function item({ href, label, sub, image, iconChar }) {
  const link = make('a', 'searchlive__item');
  link.href = href;
  if (iconChar) link.appendChild(make('span', 'searchlive__thumb', iconChar));
  else link.appendChild(thumb(label, image));
  const text = make('div', 'searchlive__text');
  text.appendChild(make('strong', null, label));
  if (sub) text.appendChild(make('span', null, sub));
  link.appendChild(text);
  return link;
}

function group(title, children) {
  if (!children.length) return null;
  const wrap = make('div', 'searchlive__group');
  wrap.appendChild(make('p', 'searchlive__title', title));
  children.forEach((child) => wrap.appendChild(child));
  return wrap;
}

function setup(form) {
  const input = form.querySelector('[data-live-input]');
  if (!input) return;

  const panel = make('div', 'searchlive');
  panel.hidden = true;
  form.appendChild(panel);

  let items = [];
  let active = -1;
  let timer = 0;
  let request = 0;

  const close = () => {
    panel.hidden = true;
    panel.replaceChildren();
    items = [];
    active = -1;
  };

  const setActive = (next) => {
    if (!items.length) return;
    active = (next + items.length) % items.length;
    items.forEach((node, index) => node.classList.toggle('is-active', index === active));
    items[active].scrollIntoView({ block: 'nearest' });
  };

  const paint = (q, data) => {
    const people = data.people ?? [];
    const groups = data.groups ?? [];
    const meetups = data.meetups ?? [];
    const builds = data.builds ?? [];
    const parts = data.parts ?? [];
    const services = data.services ?? [];

    const nodes = [
      group(t('Drivers'), people.map((person) =>
        item({
          href: `/u/${encodeURIComponent(person.username)}`,
          label: person.displayName,
          sub: [person.car, person.city].filter(Boolean).join(' · ') || `@${person.username}`,
          image: person.avatar,
        }),
      )),
      group(t('Groups'), groups.map((g) =>
        item({
          href: `/groups/${encodeURIComponent(g.slug)}`,
          label: g.name,
          sub: `${t(g.privacy === 'invite' ? 'Invite only' : g.privacy === 'private' ? 'Private' : 'Open')} · ${g.members ?? 0}`,
          iconChar: '🛡',
        }),
      )),
      group(t('Meetups'), meetups.map((meetup) =>
        item({
          href: `/meetups/${meetup.id}`,
          label: meetup.title,
          sub: [meetup.placeName, (meetup.startsAt || '').slice(0, 10)].filter(Boolean).join(' · '),
          iconChar: '📍',
        }),
      )),
      group(t('Builds'), builds.map((build) =>
        item({
          href: `/builds/${build.id}`,
          label: build.title || [build.make, build.model].filter(Boolean).join(' '),
          sub: [`@${build.username}`, [build.make, build.model].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(' · '),
          image: build.cover,
        }),
      )),
      group(t('Parts'), parts.map((part) =>
        item({
          href: `/services/parts/${part.id}`,
          label: part.title,
          sub: [part.priceLabel, `@${part.username}`].filter(Boolean).join(' · '),
          image: part.cover,
        }),
      )),
      group(t('Services'), services.map((service) =>
        item({
          href: `/services/maintenance/${service.id}`,
          label: service.title,
          sub: [service.placeName, `@${service.username}`].filter(Boolean).join(' · '),
          image: service.cover,
        }),
      )),
    ].filter(Boolean);

    panel.replaceChildren();

    if (!nodes.length) {
      panel.appendChild(make('p', 'searchlive__empty', t('No matches for "{q}".', { q })));
      panel.hidden = false;
      items = [];
      active = -1;
      return;
    }

    nodes.forEach((node) => panel.appendChild(node));

    const all = make('a', 'searchlive__all', t('See all results'));
    all.href = `/search?q=${encodeURIComponent(q)}`;
    panel.appendChild(all);

    panel.hidden = false;
    items = [...panel.querySelectorAll('.searchlive__item')];
    active = -1;
  };

  const load = async (q) => {
    const mine = ++request;
    panel.replaceChildren(make('p', 'searchlive__hint', t('Searching…')));
    panel.hidden = false;

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        headers: { 'x-requested-with': 'fetch' },
        credentials: 'same-origin',
      });
      const data = await response.json();
      if (mine !== request) return; // a newer keystroke won
      paint(q, data);
    } catch {
      if (mine !== request) return;
      panel.replaceChildren(make('p', 'searchlive__empty', t('Search failed. Try again.')));
      panel.hidden = false;
      items = [];
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < MIN_CHARS) {
      request += 1; // cancel any in-flight result
      close();
      return;
    }
    timer = setTimeout(() => load(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (panel.hidden || !items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active - 1);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      items[active].click();
    }
  });

  // Keep focus on the input while a result is clicked.
  form.addEventListener('mousedown', (event) => {
    if (panel.contains(event.target)) event.preventDefault();
  });

  input.addEventListener('blur', () => setTimeout(close, 160));

  form.addEventListener('submit', close);
}

document.querySelectorAll('[data-live-search]').forEach(setup);
