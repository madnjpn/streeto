/* ══════════════════════════════════════════════════════════════════
   STREETO — part search
   Three ways in: a part number or cross reference, a car walked down
   year by year, or a VIN that is read first. The answers come from the
   parts catalogue on the server, so this only draws them.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

const panels = [...document.querySelectorAll('.pspanel')];

{
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';

  /* ── the three ways in ─────────────────────────────────────── */

  document.querySelectorAll('[data-ps-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.psTab;
      document.querySelectorAll('[data-ps-tab]').forEach((other) => {
        const on = other === tab;
        other.classList.toggle('is-active', on);
        other.setAttribute('aria-selected', String(on));
      });
      panels.forEach((panel) => { panel.hidden = panel.dataset.psPanel !== name; });
      // The catalogue tree is only fetched when it is needed.
      if (name === 'car' && !makesLoaded) {
        makesLoaded = true;
        loadMakes();
      }
      if (name === 'garage') loadGarage();
    });
  });

  /* ── talking to the server ─────────────────────────────────── */

  async function ask(url) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'fetch' },
    });
    const data = await res.json().catch(() => ({ ok: false, error: t('Something went wrong.') }));
    if (!res.ok || data.ok === false) throw new Error(data.error || t('Something went wrong.'));
    return data;
  }

  const loading = (message) => {
    const p = document.createElement('p');
    p.className = 'muted psloading';
    p.textContent = message || t('Looking...');
    return p;
  };

  /* ── the results ───────────────────────────────────────────── */

  function partNode(part) {
    const row = document.createElement('article');
    row.className = 'pspart';

    if (part.image) {
      const img = document.createElement('img');
      img.className = 'pspart__img';
      // RockAuto blocks this server's IP; proxy the image so the browser can see it.
      // images.weserv.nl requires the full URL with protocol.
      const fullUrl = part.image.startsWith('http') ? part.image : `https://www.rockauto.com/${part.image}`;
      img.src = `https://images.weserv.nl/?url=${encodeURIComponent(fullUrl)}&w=160`;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      row.append(img);
    }

    const body = document.createElement('div');
    body.className = 'pspart__body';

    const brand = document.createElement('strong');
    brand.className = 'pspart__brand';
    brand.textContent = part.brand || '';
    body.append(brand);

    const number = document.createElement('span');
    number.className = 'pspart__number';
    number.textContent = part.partNumber || '';
    body.append(number);

    if (part.description) {
      const what = document.createElement('span');
      what.className = 'pspart__what';
      what.textContent = part.description;
      body.append(what);
    }

    if (part.note) {
      const note = document.createElement('span');
      note.className = 'pspart__note';
      note.textContent = part.note;
      body.append(note);
    }

    const foot = document.createElement('div');
    foot.className = 'pspart__foot';
    if (part.price) {
      const price = document.createElement('strong');
      price.className = 'pspart__price';
      price.textContent = `$${part.price}`;
      foot.append(price);
    }
    if (part.url) {
      const link = document.createElement('a');
      link.className = 'link';
      link.href = part.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = t('See it at RockAuto');
      foot.append(link);
    }
    body.append(foot);
    row.append(body);
    return row;
  }

  /** The other places the same number can be looked up. */
  function renderSources(host, sources) {
    const old = host.querySelector('.pssources');
    if (old) old.remove();
    if (!sources || !sources.length) return;
    const box = document.createElement('div');
    box.className = 'pssources';
    const label = document.createElement('p');
    label.className = 'field__label';
    label.textContent = t('Look the same number up here too');
    box.append(label);
    const grid = document.createElement('div');
    grid.className = 'pssources__grid';
    for (const source of sources) {
      const link = document.createElement('a');
      link.className = 'pssource';
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const name = document.createElement('strong');
      name.textContent = source.label;
      const note = document.createElement('span');
      note.textContent = source.note || '';
      link.append(name, note);
      grid.append(link);
    }
    box.append(grid);
    host.append(box);
  }

  function renderParts(host, parts, emptyText) {
    host.replaceChildren();
    if (parts.length) {
      const head = document.createElement('p');
      head.className = 'muted small';
      head.textContent = t('{n} parts found', { n: parts.length });
      host.append(head);
      for (const part of parts) host.append(partNode(part));
    } else if (emptyText) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = emptyText;
      host.append(p);
    }
  }

  /* ── 1. part number, cross reference or name ───────────────── */

  const searchForm = document.querySelector('[data-ps-search]');
  const searchInput = document.querySelector('[data-ps-input]');
  const numberResults = document.querySelector('[data-ps-panel="number"] [data-ps-results]');

  const runNumberSearch = async (query) => {
    if (!query) return;
    numberResults.replaceChildren(loading(t('Looking in the catalogue...')));

    // The other places are answered straight away, so the driver is not
    // left waiting when the catalogue is slow.
    ask(`/api/parts/sources?q=${encodeURIComponent(query)}`)
      .then((data) => renderSources(numberResults, data.sources || []))
      .catch(() => {});

    try {
      const data = await ask(`/api/parts/search?q=${encodeURIComponent(query)}`);
      const warning = data.warning
        ? (() => {
            const note = document.createElement('p');
            note.className = 'pswarn';
            note.textContent = data.warning;
            return note;
          })()
        : null;
      renderParts(numberResults, data.parts || [], t('Nothing found for that number.'));
      if (warning) numberResults.prepend(warning);
      renderSources(numberResults, data.sources || []);
    } catch (error) {
      numberResults.replaceChildren();
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = error.message;
      numberResults.append(p);
    }
  };

  searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = (searchInput?.value || '').trim();
    if (!query) return;
    const url = new URL(location.href);
    url.searchParams.set('q', query);
    history.replaceState({}, '', url);
    runNumberSearch(query);
  });

  /* ── 2. by car ──────────────────────────────────────────────── */

  const makeSelect = document.querySelector('[data-ps-make]');
  const yearSelect = document.querySelector('[data-ps-year]');
  const modelSelect = document.querySelector('[data-ps-model]');
  const engineSelect = document.querySelector('[data-ps-engine]');
  const groupBox = document.querySelector('[data-ps-groups]');
  const groupList = document.querySelector('[data-ps-group-list]');
  const typeBox = document.querySelector('[data-ps-types]');
  const typeList = document.querySelector('[data-ps-type-list]');
  const twinBox = document.querySelector('[data-ps-twins]');
  const twinList = document.querySelector('[data-ps-twin-list]');
  const carResults = document.querySelector('[data-ps-panel="car"] [data-ps-results]');

  /** The car that is being looked at, as the server wants it. */
  const carQuery = () => new URLSearchParams({
    make: car.make,
    year: car.year,
    model: car.model,
    engine: engineSelect?.selectedOptions[0]?.textContent || '',
    carcode: car.carcode,
  });

  /**
   * Fill a select with options.
   * A choice the driver has already made stays, as long as it is still
   * one of the options - otherwise the first one is taken.
   */
  const fill = (select, items, label) => {
    const was = select.value;
    select.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = label;
    select.append(blank);
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.append(option);
    }
    select.disabled = !items.length;
    const keep = items.some((item) => String(item.id) === was) ? was : '';
    select.value = keep || (items.length ? items[0].id : '');
    return select.value;
  };

  /**
   * Counts the choices, so a slow answer never overwrites a newer one.
   * Every choice carries its own number down the chain, so the steps
   * that belong together are never mixed up.
   */
  let pickToken = 0;
  const startPick = () => ++pickToken;

  const car = { make: '', year: '', model: '', engine: '', carcode: '', group: '' };
  let makesLoaded = false;

  /**
   * A line to type a value the catalogue could not offer.
   * The select stays - the typed value is added to it, so the rest of
   * the chain reads it like any other choice.
   */
  const manualField = (select, key, label) => {
    if (!select || select.dataset.manualReady) return;
    select.dataset.manualReady = '1';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.placeholder = label;
    input.dataset.psManual = key;
    input.autocomplete = 'off';
    select.insertAdjacentElement('afterend', input);
    input.addEventListener('change', async () => {
      const value = input.value.trim();
      if (!value) return;
      let option = [...select.options].find((o) => o.value === value);
      if (!option) {
        option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      select.value = value;
      select.disabled = false;
      car[key] = value;
      if (key === 'year') {
        car.model = '';
        await loadModels(pickToken);
        await loadEngines(pickToken);
        await loadGroups();
      } else if (key === 'model') {
        await loadEngines(pickToken);
        await loadGroups();
      }
    });
  };

  const enableManualYearFallback = () => manualField(yearSelect, 'year', t('Type the year'));
  const enableManualModelFallback = () => manualField(modelSelect, 'model', t('Type the model'));
  /** The engines of the car that is being looked at. */
  let engineList = [];

  /**
   * The engine of the car, when the VIN tells us which one it is.
   * The catalogue lists every engine of the model, and the first one in
   * the list is often the biggest - a 3.0 litre V6 for a car that has
   * the 1.8 litre under its bonnet. The VIN knows the size and the
   * number of cylinders, so the right engine can be picked out.
   */
  const matchEngine = (engines, vin) => {
    if (!vin) return '';
    const litres = Number(vin.displacement);
    const cylinders = Number(vin.cylinders);
    if (!litres || !cylinders) return '';
    const want = `${litres.toFixed(1)}L`;
    const found = engines.find((engine) => {
      const name = String(engine.name || '').toUpperCase();
      if (!name.startsWith(want)) return false;
      return new RegExp(`(^|[^0-9])${cylinders}([^0-9]|$)`).test(name);
    });
    return found ? found.id : '';
  };

  const loadMakes = async () => {
    yearSelect.replaceChildren();
    modelSelect.replaceChildren();
    engineSelect.replaceChildren();
    groupBox.hidden = true;
    carResults.replaceChildren();
    try {
      const data = await ask('/api/parts/tree');
      car.make = fill(makeSelect, data.makes || [], t('Choose a make'));
    } catch (error) {
      makeSelect.replaceChildren();
      const option = document.createElement('option');
      option.textContent = error.message;
      makeSelect.append(option);
    }
  };

  const autoChain = async (step) => {
    // Auto-chain: make → year → model → engine → search
    await loadYears(pickToken);
    await loadModels(pickToken);
    await loadEngines(pickToken);
    await loadGroups();
  };

  const loadYears = async (token) => {
    modelSelect.replaceChildren();
    engineSelect.replaceChildren();
    groupBox.hidden = true;
    carResults.replaceChildren();
    if (!car.make) return;
    try {
      const data = await ask(`/api/parts/tree?make=${encodeURIComponent(car.make)}`);
      if (token !== pickToken) return;
      car.year = fill(yearSelect, (data.years || []).map((y) => ({ id: y, name: y })), t('Choose a year'));
      if (!(data.years || []).length) {
        yearSelect.disabled = true;
      } else {
        yearSelect.disabled = false;
      }
    } catch (error) {
      console.error('[loadYears] error:', error);
      if (token !== pickToken) return;
      yearSelect.replaceChildren();
      yearSelect.disabled = true;
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = t('The parts catalogue is not answering right now. You can still type the year manually or try again later.');
      carResults.replaceChildren(p);
      // Allow manual year entry
      enableManualYearFallback();
    }
  };

  const loadModels = async (token) => {
    engineSelect.replaceChildren();
    groupBox.hidden = true;
    carResults.replaceChildren();
    if (!car.make || !car.year) {
      return;
    }
    try {
      const data = await ask(`/api/parts/tree?make=${encodeURIComponent(car.make)}&year=${encodeURIComponent(car.year)}`);
      if (token !== pickToken) return;
      car.model = fill(modelSelect, data.models || [], t('Choose a model'));
      if (!(data.models || []).length) {
        modelSelect.disabled = true;
        const p = document.createElement('p');
        p.className = 'pserror';
        p.textContent = t('No models found for this make and year. Try a different year.');
        carResults.append(p);
      } else {
        modelSelect.disabled = false;
      }
    } catch (error) {
      console.error('[loadModels] error:', error);
      if (token !== pickToken) return;
      modelSelect.replaceChildren();
      modelSelect.disabled = true;
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = t('The parts catalogue is not answering right now. Showing cached data if available, or you can type the model manually.');
      carResults.replaceChildren(p);
      // Still allow manual model entry by enabling a text input fallback
      enableManualModelFallback();
    }
  };

  const loadEngines = async (token) => {
    groupBox.hidden = true;
    carResults.replaceChildren();
    if (!car.make || !car.year || !car.model) return;
    try {
      const data = await ask(`/api/parts/tree?make=${encodeURIComponent(car.make)}&year=${encodeURIComponent(car.year)}&model=${encodeURIComponent(car.model)}`);
      if (token !== pickToken) return;
      const engines = data.engines || [];
      engineList = engines;
      car.engine = fill(engineSelect, engines.map((e) => ({ id: e.id, name: e.name })), t('Choose an engine'));
      car.carcode = car.engine;
      showTwins(data.twins);
      await loadGroups();
    } catch (error) {
      if (token !== pickToken) return;
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = t('The catalogue is not answering for the engines - the parts are still searched by make, year and model.');
      carResults.append(p);
      await loadGroups();
    }
  };

  /**
   * The same car is often sold under another name - the Toyota Altezza
   * was the Lexus IS200, the Honda Integra the Acura Integra. The
   * drivetrain parts are the same, so the other name is offered too.
   */
  /**
   * A line under the twin chips - it explains the year of a car that
   * came from a chassis code, which names a range of years and not one.
   */
  let twinNote = '';

  const showTwins = (twins) => {
    if (!twinBox || !twinList) return;
    const list = Array.isArray(twins) ? twins : [];
    if (!list.length && !twinNote) {
      twinBox.hidden = true;
      return;
    }
    twinBox.hidden = false;
    twinList.replaceChildren();
    list.slice(0, 4).forEach((twin) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = `${twin.make} ${twin.model}`;
      chip.title = t('The same car is sold under this name - the drivetrain parts are the same.');
      chip.addEventListener('click', () => switchToTwin(twin, chip));
      twinList.append(chip);
    });
    if (twinNote) {
      const p = document.createElement('p');
      p.className = 'muted small pstwin__note';
      p.textContent = twinNote;
      twinList.append(p);
    }
  };

  /**
   * Say why no model was picked, in the row the twins use.
   */
  const showTwinNote = (text) => {
    if (!twinBox || !twinList) return;
    twinBox.hidden = false;
    twinList.replaceChildren();
    const p = document.createElement('p');
    p.className = 'muted small pstwin__note';
    p.textContent = text;
    twinList.append(p);
  };

  /**
   * Put the other name of the car in the picker.
   * The catalogue is written in the names of the market each car was
   * sold in, so the other name is not always there. It is looked up
   * first - the picker is never left half filled.
   */
  const switchToTwin = async (twin, chip) => {
    const ownName = `${car.make} ${car.model}`;
    const year = String(car.year || '');
    const keep = (text) => {
      const p = document.createElement('p');
      p.className = 'muted small pstwin__note';
      p.textContent = text;
      if (chip) chip.disabled = true;
      twinList?.append(p);
    };
    if (chip) chip.disabled = true;
    const at = pickToken;
    try {
      // Look before leaping: the catalogue uses the names of the market
      // the car was sold in, so the other name is not always there.
      const [byModel, byYear] = await Promise.all([
        ask(`/api/parts/tree?make=${encodeURIComponent(twin.make)}&year=${encodeURIComponent(year)}`),
        ask(`/api/parts/tree?make=${encodeURIComponent(twin.make)}`),
      ]);
      if (at !== pickToken) return;
      const models = Array.isArray(byModel.models) ? byModel.models : [];
      const years = (Array.isArray(byYear.years) ? byYear.years : []).map(String);
      const make = [...(makeSelect?.options || [])].find((o) => o.value === twin.make);
      const there = Boolean(make)
        && years.includes(year)
        && models.some((m) => String(m.id ?? m).toUpperCase() === twin.model);
      if (!there) {
        keep(t('The catalogue lists this car only as {name}.', { name: ownName }));
        return;
      }

      // Now the picker can be moved, and it is moved in one go.
      const token = startPick();
      makeSelect.value = make.value;
      car.make = make.value;
      await loadYears(token);
      if (token !== pickToken) return;
      const sameYear = [...(yearSelect?.options || [])].find((o) => o.value === year);
      if (!sameYear) return;
      yearSelect.value = sameYear.value;
      car.year = sameYear.value;
      await loadModels(token);
      if (token !== pickToken) return;
      const model = [...(modelSelect?.options || [])].find((o) => o.value === twin.model);
      if (!model) return;
      modelSelect.value = model.value;
      car.model = model.value;
      await loadEngines(token);
    } catch (error) {
      if (at !== pickToken) return;
      keep(error.message);
    }
  };

  /**
   * Put a car into the picker - the make, the model and the engine that
   * really belongs to it.
   * The number knows the most; the garage fills the gaps a number from
   * another market cannot answer (a European VIN has no year in it).
   */
  const applyVin = async (vin, fallback = {}) => {
    if (!vin) return false;
    const token = startPick();
    if (makeSelect && makeSelect.options.length < 2) await loadMakes();

    // The car is often sold under more than one name, and the
    // catalogue only has one of them: the Integra is an Acura there,
    // the Altezza a Lexus. Every name is tried, the car's own first,
    // then what the garage wrote.
    const names = [];
    const addName = (make, model) => {
      const wantedMake = String(make || '').toUpperCase();
      const wantedModel = String(model || '').toUpperCase();
      if (!wantedMake) return;
      if (names.some((one) => one.make === wantedMake && one.model === wantedModel)) return;
      names.push({ make: wantedMake, model: wantedModel });
    };
    (Array.isArray(vin.names) ? vin.names : []).forEach((one) => addName(one.make, one.model));
    addName(vin.make, vin.model);
    addName(fallback.make, fallback.model);

    const findMake = (name) => {
      const wanted = String(name || '').toUpperCase();
      if (!wanted) return null;
      return [...(makeSelect?.options || [])].find((o) => o.value === wanted) || null;
    };
    const findYear = (value) => {
      const wanted = String(value || '');
      if (!wanted) return null;
      return [...(yearSelect?.options || [])].find((o) => o.value === wanted) || null;
    };
    // Add a value to a select when the catalogue did not offer it.
    const offer = (select, value) => {
      if (!select || !value) return;
      let option = [...select.options].find((o) => o.value === value);
      if (!option) {
        option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      select.disabled = false;
      select.value = value;
    };
    // The catalogue writes "316i", the certificate writes "316 I" -
    // so the spaces and the dots do not count.
    const plain = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    // A chassis code names the years the car was built, not the year it
    // is: the first of them is used until the driver says otherwise,
    // and the picker says so.
    const rangeYear = String(vin.years || '').match(/\d{4}/)?.[0] || '';
    const yearWanted = String(vin.year || fallback.year || rangeYear || '');
    twinNote = !vin.year && !fallback.year && rangeYear
      ? t('This code was built {years} - set the year of your car.', { years: String(vin.years) })
      : '';
    // The name the catalogue knew first, with the model still to pick.
    let settled = null;

    for (const name of names) {
      const make = findMake(name.make);
      if (!make) continue;
      if (makeSelect.value !== make.value) {
        makeSelect.value = make.value;
        car.make = make.value;
        await loadYears(token);
      }
      car.make = make.value;

      const year = findYear(yearWanted);
      if (!year) {
        // A car from another market may carry no year in its number at
        // all - then the make is set and the year is picked by hand.
        if (!yearWanted) {
          yearSelect.value = '';
          car.year = '';
          return true;
        }
        // The catalogue does not have this make for that year - keep the
        // car as the garage wrote it and let the driver carry on.
        if (!settled) settled = { make: make.value, year: yearWanted };
        continue;
      }
      yearSelect.value = year.value;
      car.year = year.value;
      await loadModels(token);

      // The empty option at the top is the "choose one" line - it is not
      // a model.
      const choices = [...(modelSelect?.options || [])].filter((o) => o.value);
      const model = choices.find((o) => plain(o.value) === plain(name.model))
        // The certificate may write the make in front of the model.
        || choices.find((o) => {
          return name.model && (plain(name.model).includes(plain(o.value)) || plain(o.value).includes(plain(name.model)));
        });

      if (!model) {
        if (!settled) settled = { make: make.value, year: year.value };
        continue;
      }

      modelSelect.value = model.value;
      car.model = model.value;
      await loadEngines(token);

      // The engine of the car, not the first one in the list.
      const engine = matchEngine(engineList, vin);
      if (!engine) {
        // Nothing told the engine - the driver picks it.
        await loadGroups();
        return true;
      }
      engineSelect.value = engine;
      car.engine = engine;
      car.carcode = engine;
      await loadGroups();
      return true;
    }

    // No name fitted a model. The make and the year stay as they are
    // and the driver picks the model from the list - a model that is
    // offered but is not the car is worse than none at all.
    if (settled) {
      const make = findMake(settled.make);
      if (make && makeSelect.value !== make.value) {
        makeSelect.value = make.value;
        car.make = make.value;
        await loadYears(token);
      }
      car.make = settled.make;
      const year = findYear(settled.year);
      if (year) {
        yearSelect.value = year.value;
        car.year = year.value;
        await loadModels(token);
      } else {
        // The catalogue has the make but not that year - keep the year
        // the garage wrote and let the driver pick the model by hand.
        offer(yearSelect, settled.year);
        car.year = settled.year;
        modelSelect.replaceChildren();
        modelSelect.disabled = true;
      }
      modelSelect.value = '';
      car.model = '';
      // The number named a model the catalogue does not use - say so
      // instead of leaving the list silent.
      const named = names.find((one) => one.model);
      if (named) {
        showTwinNote(t('The catalogue does not list {name} - pick the model from the list.', { name: named.model }));
      }
      return true;
    }

    // The catalogue has no tree for this car - the garage still knows
    // what it is, so the picker is filled from the car itself. The
    // search then runs on what the driver picks.
    const directMake = String(vin.make || fallback.make || '').trim().toUpperCase();
    const directYear = String(vin.year || fallback.year || '').trim();
    const directModel = String(vin.model || fallback.model || '').trim().toUpperCase();
    const directEngine = String(vin.engine || fallback.engine || '').trim();

    if (!directMake) return false;

    offer(makeSelect, directMake);
    car.make = directMake;

    if (directYear) {
      offer(yearSelect, directYear);
      car.year = directYear;
    } else {
      car.year = '';
      enableManualYearFallback();
    }

    if (directModel) {
      offer(modelSelect, directModel);
      car.model = directModel;
    } else {
      car.model = '';
      enableManualModelFallback();
    }

    if (directEngine) {
      offer(engineSelect, directEngine);
      car.engine = directEngine;
      car.carcode = directEngine;
    }

    await loadGroups();
    showTwinNote(t('The catalogue has no tree for this car - pick the group, or search by part number.'));
    return true;
  };

  const loadGroups = async () => {
    groupList.replaceChildren();
    typeList.replaceChildren();
    typeBox.hidden = true;
    carResults.replaceChildren();
    if (!car.make || !car.year || !car.model) return;
    groupBox.hidden = false;
    groupList.append(loading(t('Looking...')));
    try {
      const query = carQuery();
      const data = await ask(`/api/parts/vehicle?${query}`);
      const groups = data.groups || [];
      groupList.replaceChildren();
      if (!groups.length) {
        const p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = t('No groups for that car.');
        groupList.append(p);
        return;
      }
      for (const group of groups) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = group.name;
        chip.addEventListener('click', () => {
          groupList.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          loadPartTypes(group.id);
        });
        groupList.append(chip);
      }
    } catch (error) {
      groupList.replaceChildren();
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = error.message;
      groupList.append(p);
    }
  };

  /** The kinds of part inside the group that was picked. */
  const loadPartTypes = async (group) => {
    car.group = group;
    typeList.replaceChildren();
    typeBox.hidden = false;
    carResults.replaceChildren();
    typeList.append(loading(t('Looking...')));
    try {
      const query = carQuery();
      query.set('group', group);
      const data = await ask(`/api/parts/vehicle?${query}`);
      const types = data.types || [];
      typeList.replaceChildren();
      if (!types.length) {
        const p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = t('Nothing found in that group.');
        typeList.append(p);
        return;
      }
      for (const type of types) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = type.name;
        chip.addEventListener('click', () => {
          typeList.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          loadGroupParts(group, type.id);
        });
        typeList.append(chip);
      }
    } catch (error) {
      typeList.replaceChildren();
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = error.message;
      typeList.append(p);
    }
  };

  const loadGroupParts = async (group, parttype) => {
    carResults.replaceChildren(loading(t('Looking...')));
    try {
      const query = carQuery();
      query.set('group', group);
      query.set('parttype', parttype);
      const data = await ask(`/api/parts/vehicle?${query}`);
      renderParts(carResults, data.parts || [], t('Nothing found in that group.'));
    } catch (error) {
      carResults.replaceChildren();
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = error.message;
      carResults.append(p);
    }
  };


  /* When the catalogue has nothing to say, the driver types the year
     and the model by hand. The search still runs - it is only the
     catalogue's tree that is missing. */
  makeSelect?.addEventListener('change', async () => {
    const token = startPick();
    twinNote = '';
    car.make = makeSelect.value;
    await loadYears(token);
    await loadModels(token);
    await loadEngines(token);
    await loadGroups();
  });
  yearSelect?.addEventListener('change', async () => {
    const token = startPick();
    // The year is the driver's own now - the note about the range of a
    // chassis code has done its work.
    twinNote = '';
    car.year = yearSelect.value;
    await loadModels(token);
    await loadEngines(token);
    await loadGroups();
  });
  modelSelect?.addEventListener('change', async () => {
    const token = startPick();
    twinNote = '';
    car.model = modelSelect.value;
    await loadEngines(token);
    await loadGroups();
  });
  engineSelect?.addEventListener('change', async () => {
    car.carcode = engineSelect.value;
    car.engine = engineSelect.value;
    await loadGroups();
  });

  /* ── 3. by VIN ──────────────────────────────────────────────── */

  const vinForm = document.querySelector('[data-ps-vin-form]');
  const vinInput = document.querySelector('[data-ps-vin]');
  const vinOut = document.querySelector('[data-ps-vin-out]');

  vinForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const vin = (vinInput?.value || '').trim().toUpperCase();
    if (!vin) return;
    vinOut.replaceChildren(loading(t('Reading the VIN...')));
    try {
      const data = await ask(`/api/parts/vin?vin=${encodeURIComponent(vin)}`);

      // A chassis code or a frame number is shorter than a VIN and
      // carries no check digit, so it cannot be read by the government
      // service - but the maker's own catalogue is written against it.
      if (data.kind === 'chassis' || data.kind === 'frame') {
        const box = document.createElement('div');
        box.className = 'psvincard';

        const head = document.createElement('div');
        head.className = 'psvincard__head';
        const name = document.createElement('strong');
        name.textContent = data.car
          ? `${data.car.make} ${data.car.model}`
          : (data.full || data.code);
        const kind = document.createElement('span');
        kind.className = 'muted';
        kind.textContent = data.kind === 'frame'
          ? t('Frame number')
          : t('Chassis code');
        head.append(name, kind);
        // The same car is often sold under another name.
        if (Array.isArray(data.twins) && data.twins.length) {
          const twin = document.createElement('span');
          twin.className = 'muted small';
          twin.textContent = t('The same car is sold as {name}', {
            name: data.twins.map((row) => `${row.make} ${row.model}`).join(', '),
          });
          head.append(twin);
        }
        box.append(head);

        const list = document.createElement('div');
        list.className = 'psvincard__list';

        const facts = [];
        if (data.car?.years) facts.push([t('Years'), data.car.years]);
        if (data.car?.note) facts.push([t('Known as'), data.car.note]);
        facts.push([t('Chassis code'), data.code]);
        if (data.serial) facts.push([t('Serial number'), data.serial]);
        facts.push([t('As the catalogues write it'), data.normalized || '']);

        for (const [label, value] of facts) {
          if (!value) continue;
          const row = document.createElement('div');
          row.className = 'psvincard__row';
          const key = document.createElement('span');
          key.className = 'muted small';
          key.textContent = label;
          const val = document.createElement('strong');
          val.textContent = value;
          row.append(key, val);
          list.append(row);
        }
        box.append(list);

        const note = document.createElement('p');
        note.className = 'muted small';
        note.textContent = data.car
          ? t('A chassis code has no check digit, so nobody can tell whether it was typed right - this is the car it belongs to.')
          : t('A chassis code has no check digit, so nobody can tell whether it was typed right. The maker\'s own catalogue is the only place that can read it.');
        box.append(note);

        const buttons = document.createElement('div');
        buttons.className = 'btnrow';
        const oem = document.createElement('a');
        oem.className = 'btn btn--primary btn--sm';
        oem.href = data.makerUrl || data.oemUrl || '#';
        oem.target = '_blank';
        oem.rel = 'noopener noreferrer';
        oem.textContent = data.makerUrl ? t('The factory catalogue') : t('Factory parts and diagrams');
        buttons.append(oem);

        // A code the catalogue knows is carried into the picker, under
        // whichever of its names the catalogue uses.
        if (data.car) {
          const parts = document.createElement('button');
          parts.type = 'button';
          parts.className = 'btn btn--ghost btn--sm';
          parts.textContent = t('See the parts for this car');
          parts.addEventListener('click', async () => {
            parts.disabled = true;
            if (!makeSelect) {
              location.href = `/services/part-search?vin=${encodeURIComponent(data.normalized || data.code || '')}`;
              return;
            }
            document.querySelector('[data-ps-tab="car"]')?.click();
            const ok = await applyVin({ ...data.car, names: data.names || data.twins || [] });
            if (!ok) {
              const p = document.createElement('p');
              p.className = 'pserror';
              p.textContent = t('That car is not in the parts catalogue.');
              carResults.prepend(p);
            }
            parts.disabled = false;
          });
          buttons.append(parts);
        }

        const search = document.createElement('a');
        search.className = 'btn btn--ghost btn--sm';
        search.href = `/services/part-search?q=${encodeURIComponent(data.normalized || data.code)}`;
        search.textContent = t('Search parts with this code');
        buttons.append(search);
        box.append(buttons);

        if (data.sources && data.sources.length) {
          const grid = document.createElement('div');
          grid.className = 'pssources__grid';
          for (const source of data.sources) {
            const link = document.createElement('a');
            link.className = 'pssource';
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const name = document.createElement('strong');
            name.textContent = source.label;
            const note = document.createElement('span');
            note.textContent = source.note || '';
            link.append(name, note);
            grid.append(link);
          }
          box.append(grid);
        }

        vinOut.replaceChildren(box);
        return;
      }

      const car = data.car || {};
      const box = document.createElement('div');
      box.className = 'psvincard';

      const head = document.createElement('div');
      head.className = 'psvincard__head';
      const name = document.createElement('strong');
      name.textContent = [car.year, car.make, car.model].filter(Boolean).join(' ')
        || car.vin
        || t('A car from another market');
      const trim = document.createElement('span');
      trim.className = 'muted';
      trim.textContent = [car.trim, car.engine].filter(Boolean).join(' · ');
      head.append(name, trim);
      box.append(head);

      const list = document.createElement('div');
      list.className = 'psvincard__list';
      const facts = [
        [t('Body'), car.body],
        [t('Drive'), car.drive],
        [t('Doors'), car.doors],
        [t('Engine'), car.engine],
        [t('Cylinders'), car.cylinders],
        [t('Displacement'), car.displacement ? `${Number(car.displacement).toFixed(1)}L` : ''],
        [t('Fuel'), car.fuel],
        [t('Made in'), car.plant],
      ];
      for (const [label, value] of facts) {
        if (!value) continue;
        const row = document.createElement('div');
        row.className = 'psvincard__row';
        const key = document.createElement('span');
        key.className = 'muted small';
        key.textContent = label;
        const val = document.createElement('strong');
        val.textContent = value;
        row.append(key, val);
        list.append(row);
      }
      box.append(list);

      const note = document.createElement('p');
      note.className = 'muted small';
      note.textContent = car.checkDigit === false
        ? t('The ninth character is not a check digit - outside North America it usually is not one.')
        : t('The check digit of the VIN is right, so the number reads clean.');
      box.append(note);

      // A car from another market: the register knows the make and the
      // year, and the catalogue is where the model is chosen.
      let partialNote = null;
      if (car.partial) {
        partialNote = document.createElement('p');
        partialNote.className = 'psnote';
        partialNote.textContent = car.reason === 'unavailable'
          ? t('The register is not answering right now - choose the car by hand.')
          : t('This VIN is not in the North American register - it is a car from another market.');
        box.append(partialNote);
      }

      // The VIN knows the engine, so the parts can be shown for the
      // very car that was typed in. A car from another market is
      // carried into the catalogue instead, to be named there.
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn btn--primary btn--sm';
      go.textContent = car.partial ? t('Choose the car in the catalogue') : t('See the parts for this car');
      go.addEventListener('click', async () => {
        go.disabled = true;
        // The VIN check page has no picker of its own - the car is
        // handed to the part search, which does.
        if (!makeSelect) {
          location.href = `/services/part-search?vin=${encodeURIComponent(car.vin || '')}`;
          return;
        }
        document.querySelector('[data-ps-tab="car"]')?.click();
        // Pass the full VIN data with names/twins so applyVin can match against the catalogue
        const vinData = { ...car, names: data.names || data.twins || [] };
        const ok = await applyVin(vinData);
        if (!ok) {
          const p = document.createElement('p');
          p.className = 'pserror';
          p.textContent = t('That car is not in the parts catalogue.');
          if (partialNote) partialNote.after(p);
          else box.append(p);
        }
        go.disabled = false;
      });
      const btnrow = document.createElement('div');
      btnrow.className = 'btnrow';
      btnrow.append(go);
      box.append(btnrow);

      vinOut.replaceChildren(box);
    } catch (error) {
      vinOut.replaceChildren();
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = error.message;
      vinOut.append(p);
    }
  });

  /* ── 4. from the garage ──────────────────────────────────────── */

  const garageHost = document.querySelector('[data-ps-garage]');

  /** The cars of the driver, with the number of the technical passport. */
  const loadGarage = async () => {
    if (!garageHost) return;
    garageHost.replaceChildren(loading(t('Loading...')));
    try {
      const data = await ask('/api/parts/garage');
      const cars = data.vehicles || [];
      garageHost.replaceChildren();
      if (!cars.length) {
        const p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = t('Your garage is empty. Add a car and it shows up here.');
        garageHost.append(p);
        const link = document.createElement('a');
        link.className = 'btn btn--ghost btn--sm';
        link.href = '/garage/ride';
        link.textContent = t('Open My Ride');
        garageHost.append(link);
        return;
      }
      for (const car of cars) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'psgarage__car';

        const name = document.createElement('strong');
        name.textContent = car.name || [car.year, car.make, car.model].filter(Boolean).join(' ');
        const note = document.createElement('span');
        note.className = 'muted small';
        // The plate, the passport and the number of the car itself.
        const bits = [];
        if (car.plate) bits.push(car.plate);
        if (car.passport) bits.push(car.passport);
        if (car.vin) bits.push(car.vin);
        note.textContent = bits.join(' · ') || t('No technical passport yet');
        button.append(name, note);
        button.addEventListener('click', () => useGarageCar(car));
        garageHost.append(button);
      }
    } catch (error) {
      garageHost.replaceChildren();
      const p = document.createElement('p');
      p.className = 'pserror';
      p.textContent = error.message;
      garageHost.append(p);
    }
  };

  /**
   * Read the car of a garage entry and put it in the picker.
   * The number of the car itself (the VIN on the certificate) is what
   * tells the engine apart - the technical passport does not.
   */
  const useGarageCar = async (car) => {
    // What the garage knows about the car - the number fills the gaps.
    const known = { make: car.make, model: car.model, year: car.year };

    // Without a number there is nothing to read - the car is picked by
    // hand instead, from what the garage knows.
    if (!car.vin) {
      document.querySelector('[data-ps-tab="car"]')?.click();
      await applyVin({ ...known, displacement: 0, cylinders: 0 });
      return;
    }
    const out = document.querySelector('[data-ps-panel="garage"] [data-ps-garage]');
    if (out) out.replaceChildren(loading(t('Reading the number...')));
    try {
      const data = await ask(`/api/parts/vin?vin=${encodeURIComponent(car.vin)}`);
      // A VIN, a chassis code and a frame number all name a car, and the
      // parts are found for any of them.
      const found = data.car || {};
      document.querySelector('[data-ps-tab="car"]')?.click();
      const ok = await applyVin({ ...found, names: data.names || data.twins || [] }, known);
      if (!ok) {
        const p = document.createElement('p');
        p.className = 'pserror';
        p.textContent = t('That car is not in the parts catalogue.');
        carResults.prepend(p);
      }
    } catch (error) {
      // A car from another market may not have a number the government
      // service reads - the garage still knows what it is.
      document.querySelector('[data-ps-tab="car"]')?.click();
      const ok = await applyVin({ ...known, displacement: 0, cylinders: 0 });
      if (out) {
        out.replaceChildren();
        const p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = ok
          ? t('The number could not be read, so the car was picked from what the garage knows. Choose the engine.')
          : t('That car is not in the parts catalogue.');
        out.append(p);
      }
    }
  };

  /* ── the first run ──────────────────────────────────────────── */

  const start = new URLSearchParams(location.search);
  const first = (start.get('q') || '').trim();
  if (first) {
    if (searchInput) searchInput.value = first;
    runNumberSearch(first);
  }

  // A car handed over from another page - the VIN check page has no
  // picker of its own, so the car is picked here.
  const paramVin = (start.get('vin') || '').trim();
  const paramMake = (start.get('make') || '').trim();
  if (paramVin) {
    if (vinInput) vinInput.value = paramVin;
    (async () => {
      try {
        const data = await ask(`/api/parts/vin?vin=${encodeURIComponent(paramVin)}`);
        document.querySelector('[data-ps-tab="car"]')?.click();
        const ok = await applyVin({ ...(data.car || {}), names: data.names || data.twins || [] });
        if (!ok) {
          const p = document.createElement('p');
          p.className = 'pserror';
          p.textContent = t('That car is not in the parts catalogue.');
          carResults.prepend(p);
        }
      } catch (error) {
        // Not a number that can be read - say so where it was typed.
        document.querySelector('[data-ps-tab="vin"]')?.click();
        vinForm?.requestSubmit();
      }
    })();
  } else if (paramMake) {
    document.querySelector('[data-ps-tab="car"]')?.click();
    applyVin({
      make: paramMake,
      year: (start.get('year') || '').trim(),
      model: (start.get('model') || '').trim(),
      years: (start.get('years') || '').trim(),
    });
  }

  /* ── initial load ── */
  loadMakes();
}
