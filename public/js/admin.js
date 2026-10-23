/* ══════════════════════════════════════════════════════════════════
   STREETO — admin console
   Opens and closes the database-backup modal. Everything inside it is
   a plain form post, so the console still works if this file never
   loads; only the modal would stay a normal inline block.
   ══════════════════════════════════════════════════════════════════ */

const openDialog = (dialog) => {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
};

document.querySelectorAll('[data-dialog-open]').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    const dialog = document.getElementById(trigger.dataset.dialogOpen);
    if (dialog) openDialog(dialog);
  });
});

document.querySelectorAll('dialog.dialog').forEach((dialog) => {
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  // A click on the dimmed backdrop closes the modal.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  if (dialog.hasAttribute('data-open')) openDialog(dialog);
});

/* ── font change (admin appearance tab) ────────────────────────── */
document.querySelectorAll('.set-font').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const slot = btn.dataset.slot === 'georgian' ? 'georgian' : 'latin';
    const font = JSON.parse(btn.dataset.font);
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const previous = btn.textContent;

    btn.disabled = true;
    btn.textContent = 'Applying...';

    try {
      const res = await fetch('/admin/font', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'fetch',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({ slot, font }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to set font (${res.status})`);
      }

      // Reload so every card preview and the whole site redraw with the
      // new English + Georgian pairing applied together.
      window.location.reload();
    } catch (err) {
      alert('Failed to set font: ' + err.message);
      btn.textContent = previous;
      btn.disabled = false;
    }
  });
});

/* ── custom font upload ────────────────────────────────────────── */
const FONT_EXT_RE = /\.(woff2?|ttf|otf)$/i;
const FONT_MAX_BYTES = 5 * 1024 * 1024;

document.querySelectorAll('.custom-font-form').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const input = form.querySelector('input[type="file"][name="font"]');
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const file = input?.files?.[0];

    if (!file) {
      alert('Font upload failed: choose a font file first.');
      return;
    }
    if (!FONT_EXT_RE.test(file.name)) {
      alert('Font upload failed: only .woff, .woff2, .ttf and .otf files are supported.');
      return;
    }
    if (file.size > FONT_MAX_BYTES) {
      alert(`Font upload failed: files must be 5 MB or smaller (yours is ${(file.size / 1048576).toFixed(1)} MB).`);
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Uploading...';

    try {
      const res = await fetch('/admin/font/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'x-requested-with': 'fetch',
          'x-csrf-token': csrf,
        },
        body: new FormData(form),
      });

      if (!res.ok) {
        const type = res.headers.get('content-type') || '';
        const message = type.includes('application/json')
          ? (await res.json().catch(() => ({}))).error
          : null;
        throw new Error(message || `Upload failed (${res.status})`);
      }

      // Reload page to show new font
      window.location.reload();
    } catch (err) {
      alert('Font upload failed: ' + err.message);
      submit.disabled = false;
      submit.textContent = 'Upload font';
    }
  });
});
