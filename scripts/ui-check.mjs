/**
 * Static UI contract check.
 *
 * It cannot see layout, but it catches the mistakes that keep coming back:
 * a page header without its text block, a hand-built avatar, an unknown
 * button or avatar variant, and a missing design-system layer.
 *
 *   npm run ui:check
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const errors = [];
const notes = [];

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const walk = (dir, predicate = () => true) =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(relative, predicate);
    return predicate(relative) ? [relative] : [];
  });

const ejsFiles = walk('views', (file) => file.endsWith('.ejs'));
const jsFiles = walk('public/js', (file) => file.endsWith('.js'));
const uiCss = read('public/css/ui-system.css');
const baseCss = read('public/css/style.css');

/* The layer must be loaded after the main stylesheet. */
const layout = read('views/layout.ejs');
const styleAt = layout.indexOf('/css/style.css');
const systemAt = layout.indexOf('/css/ui-system.css');
if (systemAt < 0) {
  errors.push('layout.ejs does not load /css/ui-system.css');
} else if (systemAt < styleAt) {
  errors.push('ui-system.css must load after style.css');
}

for (const token of [
  '--ui-space-4',
  '--ui-control-md',
  '--ui-radius-card',
  '--ui-avatar-sm',
  '--ui-safe-bottom',
]) {
  if (!uiCss.includes(token)) errors.push(`ui-system.css is missing ${token}`);
}

/* Accessibility is part of the contract, not a later cleanup. */
if (!uiCss.includes(':focus-visible')) errors.push('ui-system.css is missing the focus-visible ring');
if (!baseCss.includes('prefers-reduced-motion')) errors.push('style.css is missing reduced-motion handling');

/* Every page header is one text block plus optional actions. */
for (const file of ejsFiles) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let from = 0;
  while (true) {
    const at = source.indexOf('<div class="pagehead">', from);
    if (at < 0) break;
    const window = source.slice(at, at + 220);
    if (!window.includes('pagehead__main')) {
      errors.push(`${file}: pagehead is missing pagehead__main`);
    }
    from = at + 1;
  }
}

/* Avatars must come from the shared partial. */
for (const file of ejsFiles) {
  if (file.endsWith(path.join('partials', 'avatar.ejs'))) continue;
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (/<img[^>]*class="[^"]*\bavatar\b/.test(source)) {
    errors.push(`${file}: avatar <img> used directly; use partials/avatar.ejs`);
  }
}

const avatarVariants = new Set([
  'gen', 'online', 'globe',
  'xs', 'sm', 'md', 'lg', 'xl', 'xxl',
]);
for (const file of [...ejsFiles, ...jsFiles]) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of source.matchAll(/\bavatar--([a-z0-9-]+)/g)) {
    if (!avatarVariants.has(match[1])) {
      errors.push(`${file}: unknown avatar size .avatar--${match[1]}`);
    }
  }
}

const buttonVariants = new Set([
  'primary', 'secondary', 'ghost', 'outline', 'danger',
  'sm', 'lg', 'block', 'icon',
]);
for (const file of [...ejsFiles, ...jsFiles]) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of source.matchAll(/(?:^|[\s"'])btn--([a-z0-9-]+)/g)) {
    if (!buttonVariants.has(match[1])) {
      errors.push(`${file}: unknown button variant .btn--${match[1]}`);
    }
  }
}

notes.push(`${ejsFiles.length} templates checked`);
notes.push(`${jsFiles.length} client scripts checked`);

for (const note of notes) console.log(`  ${note}`);
if (errors.length) {
  console.error(`\n${errors.length} UI contract error(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log('\nUI contract OK.');
}
