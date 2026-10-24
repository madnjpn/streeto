/**
 * Social preview cards: one 1200x630 PNG for builds, meetups and routes.
 *
 * The server generates the card from the same data the page uses, so a
 * shared link always has a real title and image. No headless browser is
 * needed at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import opentype from 'opentype.js';
import { resolveUploadPath } from './upload-paths.js';

const WIDTH = 1200;
const HEIGHT = 630;
const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/fonts');
function loadFont(name) {
  try {
    const buffer = fs.readFileSync(path.join(FONT_DIR, name));
    return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  } catch {
    return null;
  }
}
const georgianFont = loadFont('NotoSansGeorgian-Regular.ttf');
const latinFont = loadFont('NotoSans-Regular.ttf');
const isGeorgian = (char) => /[\u10A0-\u10FF\u2D00-\u2D2F]/u.test(char);
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const wrap = (text, maxChars, maxLines = 3) => {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (!lines.length) lines.push('STREETO');
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s.,;:!?-]+$/u, '')}...`;
  }
  return lines;
};

/**
 * Render text as outlines. This is what makes Georgian titles safe even on
 * a machine with no Georgian system font installed: the Noto TTF travels
 * with the project and is converted to SVG paths by OpenType.
 */
function textPath(value, x, y, size, color, anchor = 'start') {
  const text = String(value || '');
  if (!georgianFont && !latinFont) {
    return `<text x="${x}" y="${y}" fill="${color}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}">${esc(text)}</text>`;
  }

  // Georgian and Latin live in two Noto files. We walk glyph by glyph
  // instead of asking OpenType to shape the whole string: it avoids the
  // optional GSUB features that opentype.js does not implement, and
  // Georgian does not need cursive joining or ligatures.
  const glyphs = Array.from(text).map((char) => {
    const font = isGeorgian(char) && georgianFont ? georgianFont : latinFont;
    if (!font) return { glyph: null, font: null, advance: size * 0.55 };
    const glyph = font.charToGlyph(char);
    return {
      glyph,
      font,
      advance: ((glyph.advanceWidth || font.unitsPerEm * 0.5) / font.unitsPerEm) * size,
    };
  });
  const total = glyphs.reduce((sum, item) => sum + item.advance, 0);
  let left = anchor === 'end' ? x - total : x;
  const paths = [];
  for (const item of glyphs) {
    if (item.glyph) {
      const pathData = item.glyph.getPath(left, y, size).toPathData(2);
      if (pathData) paths.push(`<path d="${pathData}" fill="${color}"/>`);
    }
    left += item.advance;
  }
  return paths.join('');
}

function cardSvg({ eyebrow, title, subtitle, meta, accent = '#1fe0ff' }) {
  const titleLines = wrap(title, title.length > 36 ? 25 : 30, 3);
  const titleSize = titleLines.length > 2 ? 58 : 68;
  const titleY = 286;
  const subtitleLines = wrap(subtitle, 48, 2);
  const subtitleY = titleY + titleLines.length * (titleSize + 14) + 18;
  const text = [];
  text.push(textPath('STREETO', 72, 98, 38, '#f4f1e8'));
  text.push(textPath(String(eyebrow || '').toUpperCase(), 72, 154, 20, accent));
  titleLines.forEach((line, index) => {
    text.push(textPath(line, 72, titleY + index * (titleSize + 14), titleSize, '#ffffff'));
  });
  subtitleLines.forEach((line, index) => {
    text.push(textPath(line, 72, subtitleY + index * 34, 27, '#d3d9df'));
  });
  text.push(textPath(String(meta || 'streeto.net').slice(0, 90), 72, 568, 21, '#8e9aa7'));
  text.push(textPath('STREETO.NET', 1128, 568, 20, accent, 'end'));
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#070b10"/>
      <stop offset="0.55" stop-color="#0d1922"/>
      <stop offset="1" stop-color="#101018"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#070b10" stop-opacity="0.96"/>
      <stop offset="0.72" stop-color="#070b10" stop-opacity="0.62"/>
      <stop offset="1" stop-color="#070b10" stop-opacity="0.2"/>
    </linearGradient>
    <radialGradient id="glow" cx="82%" cy="20%" r="65%">
      <stop offset="0" stop-color="${esc(accent)}" stop-opacity="0.27"/>
      <stop offset="1" stop-color="${esc(accent)}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <path d="M0 520 C250 455 480 610 720 530 S1030 430 1200 500 L1200 630 L0 630 Z" fill="${esc(accent)}" opacity="0.08"/>
  <path d="M0 420 C220 360 420 505 660 430 S1010 330 1200 390" fill="none" stroke="${esc(accent)}" stroke-width="3" opacity="0.28"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fade)"/>
  <line x1="72" y1="184" x2="260" y2="184" stroke="${esc(accent)}" stroke-width="3"/>
  ${text.join('')}
</svg>`;
}

async function coverLayer(coverPath) {
  if (!coverPath) return null;
  const file = resolveUploadPath(coverPath);
  if (!file || !fs.existsSync(file)) return null;
  try {
    return await sharp(file)
      .resize(WIDTH, HEIGHT, { fit: 'cover' })
      .modulate({ brightness: 0.52, saturation: 0.9 })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** Build a PNG card. `key` lets repeated requests reuse a short-lived buffer. */
export async function renderOgImage({ key, eyebrow, title, subtitle, meta, coverPath, accent }) {
  const cacheKey = key || `${eyebrow}|${title}|${subtitle}|${coverPath || ''}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.buffer;

  const overlay = Buffer.from(cardSvg({ eyebrow, title, subtitle, meta, accent }));
  const base = await coverLayer(coverPath);
  const image = base
    ? await sharp(base)
        .composite([{ input: overlay, top: 0, left: 0 }])
        .png()
        .toBuffer()
    : await sharp(overlay).png().toBuffer();

  cache.set(cacheKey, { at: Date.now(), buffer: image });
  return image;
}

export default { renderOgImage };
