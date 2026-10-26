/* ══════════════════════════════════════════════════════════════════
   STREETO — admin console: translations
   The Georgian field saves itself the moment you leave it, so a
   correction is on the site straight away - no save button, no reload.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

const csrf = document.querySelector('meta[name="csrf-token"]')?.content;

/** POST to the admin API and report what happened. */
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
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.problems = data.errors || [];
    error.warnings = data.warnings || [];
    throw error;
  }
  return data;
}

/** Show a short state next to the row being edited. */
const state = (row, message, kind = '') => {
  const el = row.querySelector('[data-tr-state]');
  if (!el) return;
  el.textContent = message;
  el.className = `trrow__state${kind ? ` is-${kind}` : ''}`;
  if (message) setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 2500);
};

/** Show what the server found wrong with the new text. */
const warn = (row, problems, bad = false) => {
  let el = row.querySelector('[data-tr-warn]');
  if (!el) {
    el = document.createElement('div');
    el.className = 'trrow__warn';
    el.setAttribute('data-tr-warn', '');
    row.querySelector('.trrow__ka')?.appendChild(el);
  }
  if (!problems || !problems.length) {
    el.textContent = '';
    el.className = 'trrow__warn';
    return;
  }
  el.textContent = problems
    .map((p) => (p && p.key ? t(p.key, p.vars) : String(p)))
    .join(' ');
  el.className = `trrow__warn${bad ? ' is-bad' : ''}`;
};

/* ── save a Georgian value on blur ──────────────────────────────── */
document.querySelectorAll('[data-trrow]').forEach((row) => {
  const input = row.querySelector('[data-tr-ka]');
  const key = row.dataset.key;
  if (!input || !key) return;

  const save = async () => {
    const value = input.value;
    if (value === input.dataset.saved) return;
    state(row, t('Saving…'));
    try {
      const data = await post('/admin/translations', { key, value });
      input.dataset.saved = value;
      state(row, t('Saved'), 'is-ok');
      warn(row, data.warnings || []);
    } catch (err) {
      const problems = err.problems && err.problems.length ? err.problems : [{ key: err.message }];
      state(row, t('Not saved'), 'is-bad');
      warn(row, problems, true);
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      input.blur();
    }
  });
});

/* ── filter as you type ─────────────────────────────────────────── */
const filter = document.querySelector('.adminfilter input[type="search"]');
filter?.addEventListener('input', () => {
  const needle = filter.value.trim().toLowerCase();
  document.querySelectorAll('[data-trrow]').forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.hidden = needle !== '' && !text.includes(needle);
  });
});

/* ── machine translation ─────────────────────────────────────────── */
const autoBtn = document.querySelector('[data-tr-auto]');
const autoStatus = document.querySelector('[data-tr-auto-status]');
const autoAll = document.querySelector('[data-tr-auto-all]');
const autoLabel = document.querySelector('[data-tr-auto-label]');
const syncAutoLabel = () => {
  if (autoLabel) {
    autoLabel.textContent = autoAll?.checked ? t('Auto-translate all') : t('Auto-translate missing');
  }
};
autoAll?.addEventListener('change', syncAutoLabel);
syncAutoLabel();
if (autoBtn) {
  autoBtn.addEventListener('click', async () => {
    const retranslate = Boolean(autoAll?.checked);
    const rows = [...document.querySelectorAll(
      retranslate ? '[data-trrow]:not([hidden])' : '[data-trrow].trrow--missing:not([hidden])',
    )];
    if (!rows.length) {
      if (autoStatus) {
        autoStatus.textContent = retranslate
          ? t('No strings on this page.')
          : t('No missing strings on this page.');
      }
      return;
    }

    if (retranslate && !window.confirm(t('This overwrites the existing Georgian text for every visible string, including manual corrections. Continue?'))) {
      return;
    }

    autoBtn.disabled = true;
    let done = 0;
    let failed = 0;
    const summaryCount = document.querySelector('.tr__summary .tr__missing strong');
    let missingLeft = summaryCount ? Number(summaryCount.textContent) : null;

    // Gemini translates a group in one request, so the free quota is not
    // spent one key at a time. Smaller batches keep the JSON reply short.
    const BATCH_SIZE = 50;
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      const keys = [];
      for (const row of batch) {
        const input = row.querySelector('[data-tr-ka]');
        if (!input || !row.dataset.key) continue;
        state(row, t('Translating…'));
        keys.push(row.dataset.key);
      }
      if (!keys.length) continue;

      let results = new Map();
      try {
        let data;
        try {
          data = await post('/admin/translations/auto-batch', { keys, force: retranslate });
        } catch (err) {
          // The Gemini free tier allows a limited number of requests per
          // minute. Give it a moment once before giving up on the batch.
          if (err.status !== 429) throw err;
          await new Promise((resolve) => setTimeout(resolve, 5000));
          data = await post('/admin/translations/auto-batch', { keys, force: retranslate });
        }
        results = new Map((data.results || []).map((result) => [result.key, result]));
      } catch (err) {
        failed += batch.length;
        const problems = err.problems && err.problems.length ? err.problems : [{ key: err.message }];
        for (const row of batch) {
          state(row, t('Not saved'), 'is-bad');
          warn(row, problems, true);
        }
        if (autoStatus) {
          autoStatus.textContent = t('Translated {n} of {m}', { n: done, m: rows.length });
        }
        if (err.status === 429) break;
        continue;
      }

      for (const row of batch) {
        const input = row.querySelector('[data-tr-ka]');
        const key = row.dataset.key;
        if (!input || !key) continue;
        const result = results.get(key);
        if (result && result.value) {
          const wasMissing = row.classList.contains('trrow--missing');
          input.value = result.value;
          input.dataset.saved = result.value;
          row.classList.remove('trrow--missing');
          state(row, t('Saved'), 'is-ok');
          warn(row, result.warnings || []);
          done += 1;
          if (wasMissing && missingLeft !== null) {
            missingLeft = Math.max(0, missingLeft - 1);
            summaryCount.textContent = missingLeft;
          }
        } else {
          failed += 1;
          const problems = result && result.errors && result.errors.length
            ? result.errors
            : [{ key: (result && result.error) || t('Auto-translation failed. Try again later.') }];
          state(row, t('Not saved'), 'is-bad');
          warn(row, problems, true);
        }
      }

      if (autoStatus) {
        autoStatus.textContent = t('Translated {n} of {m}', { n: done, m: rows.length });
      }
      // Keep below the free tier's per-minute request limit.
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    if (autoStatus) {
      const suffix = failed ? ` ${t('{n} failed.', { n: failed })}` : '';
      autoStatus.textContent = `${t('Translated {n} of {m}', { n: done, m: rows.length })}${suffix}`;
    }
    autoBtn.disabled = false;
  });
}
