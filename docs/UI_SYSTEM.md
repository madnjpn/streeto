# STREETO UI System 1.0

One visual contract for the website, the Android WebView and the future iOS
shell. The goal is simple: a driver should recognise the same STREETO on every
page, and a developer should never have to invent a button, avatar or heading
spacing again.

The live reference is **Admin → UI system** (`/admin/style-guide`). It is
admin-only and renders the same CSS the rest of the site uses.

## 1. Non-negotiables

1. **One page shell.** Content lives in `.shell` (1280 px) or
   `.single` / `.single--narrow` (760 / 720 px). Never create a new page-width
   wrapper with a hard-coded width.
2. **One page header.** Every page starts with:
   ```html
   <div class="pagehead">
     <div class="pagehead__main">
       <p class="eyebrow">…</p>
       <h1 class="display">…</h1>
       <p class="lede">…</p>
     </div>
     <div class="pagehead__actions">…</div>
   </div>
   ```
   The header text is one block. Actions go in `.pagehead__actions` (or a
   `.btnrow`); a single `.btn` or form is also accepted and is aligned by the
   UI layer. Actions never float between the title and its description.
3. **One button family.** A clickable action uses `.btn` plus one variant:
   `btn--primary`, `btn--secondary`, `btn--ghost`, `btn--outline`,
   `btn--danger` (and optionally `btn--sm`, `btn--lg`, `btn--block`,
   `btn--icon`).
   Icon-only actions use `.iconbtn` with an `aria-label`.
4. **One avatar component.** People always come from
   `views/partials/avatar.ejs`. Choose one of:
   `avatar--xs` (26), `avatar--sm` (36), `avatar--md` (46),
   `avatar--lg` (76), `avatar--xl` (104), `avatar--xxl` (130).
   Avatars are square, `object-fit: cover`, never stretched.
5. **Text wraps, it does not disappear.** Do not set a fixed `height` on a
   block that contains copy. Use `min-height` on controls, not on text.
   Truncation is allowed only for metadata previews (chat preview, URL), not
   for the main sentence of a notification, search result or pin drop.
6. **Navigation and fixed UI have reserved space.** The fixed menu and chat
   buttons sit above the page; the footer and the last controls must clear
   them (`env(safe-area-inset-bottom)` plus the `96px` footer clearance).
7. **430 px is the widest phone we design for.** The test viewport is
   **390 × 844**; also check 430 × 932 before a release.
8. **No sideways scroll and no off-screen action.** If an action is outside
   the viewport, it is either inside an explicit horizontal carousel (and is
   reachable by swipe) or it is a bug.

## 2. Tokens

Defined in `public/css/ui-system.css`; the old theme variables stay in
`style.css`.

| Token | Value | Use |
| --- | --- | --- |
| `--ui-space-1…14` | 4, 8, 12, 16, 20, 24, 32, 40, 56 px | spacing |
| `--ui-control-sm` | 30 px | compact button |
| `--ui-control-md` | 36 px | standard button |
| `--ui-control-lg` | 44 px | large button |
| `--ui-control-icon` | 36 px | icon button |
| `--ui-radius-pill` | 999 px | buttons, search |
| `--ui-radius-card` | 16 px | cards |
| `--ui-page` | 1280 px | page shell |
| `--ui-content` | 760 px | reading column |
| `--ui-safe-*` | `env(safe-area-inset-*)` | notch / home indicator |

The 4 px spacing grid is mandatory for new components. Existing one-off
paddings are migrated as pages are touched, but new work starts on the grid.

## 3. Typography

- **Display / headings:** Oswald (or the active display font), uppercase,
  tight line-height. Use `.display`, `.card__title`, `.section-title`.
- **Body:** Inter, 14.5–15 px, line-height 1.5–1.6.
- **Metadata:** `.muted`, `.small`, `.field__label` / mono style.
- **Never** use uppercase for a full paragraph.
- **Never** put a link inside a heading; the link belongs beside it.
- Long Georgian words may break (`overflow-wrap: anywhere`) but the layout
  must not gain a horizontal scrollbar.

## 4. Buttons

| Class | Height | Notes |
| --- | --- | --- |
| `.btn` | 36 px | standard action |
| `.btn.btn--sm` | 30 px | dense rows, card footers |
| `.btn.btn--lg` | 44 px | primary page CTA |
| `.iconbtn` | 36 × 36 | icon action; always `aria-label` |
| `.iconbtn--ghost` | 32 × 32 | quiet icon action |

Rules:

- One primary action per view. If everything is primary, nothing is.
- Destructive action: `btn--danger`, never a red custom button.
- Buttons in a row use `.btnrow`; buttons in a page header use
  `.pagehead__actions`.
- Do not put a `<button>` in a card without the button family; use a link if it
  navigates.
- Every interactive control has a visible `:focus-visible` ring.
- Do not shrink a button below its token height to “make it fit”; put it on
  its own row instead. Primary page actions use `btn--lg` (44 px).

## 5. Avatars and people

- Use `partials/avatar.ejs`; pass a user object and `cls`.
- Generated initials avatars use the same square/circle shell and a stable
  hue from the username.
- In rows, the avatar is a flex item that never shrinks:
  `flex: 0 0 auto`.
- Never set only `width` or only `height` on an avatar. Both are equal.
- Profile hero: `.avatar--xl` or `.avatar--xxl`; list rows: `xs`/`sm`;
  cards: `md`/`lg`. Do not invent `--size: 37px`.

## 6. Cards, rows and forms

- `.card` is the only surface for grouped content. A card has one title and
  one idea. Use `.card--form` for a form, `.card--danger` for destructive
  settings.
- `.row` is a compact list item. If the row contains a sentence, add
  `.row--stack` so the author, message and time wrap. Long previews may use
  `.row__snippet`, which is a block and wraps.
- `.field` is label → control → hint/error. Labels are visible; placeholders
  are examples, not labels.
- Inputs use the global field styles. On iOS, fields are 16 px to prevent
  zoom; the UI layer keeps that rule.
- A form has one primary submit button; Cancel is ghost; Delete is danger.

## 7. Page patterns

### List page

```
pagehead
filters (search / tabs)
cards or rows
pagination / empty state
```

### Detail page

```
backlink
hero / cover
facts / description
primary action row
secondary sections
```

### Form page

```
backlink
pagehead
card--form
fields on the 4 px grid
sticky/footer actions (if needed)
```

### Empty state

Use `partials/empty.ejs`: icon, title, one sentence, one action. Do not leave a
blank card without an explanation.

## 8. Responsive rules

Breakpoints are inherited from `style.css`:

- `<= 620 px`: phone. Stacks columns, full-width controls, wraps filters.
- `<= 860 px`: tablet / small laptop. Sidebars hide, fixed menu appears.
- `<= 1080 px`: narrower grid.
- `> 1080 px`: full desktop shell.

On a phone:

- page padding: 12–16 px; cards may use 14–18 px;
- one column for forms and facts;
- `overflow-x: auto` is allowed only for explicit carousels and filter strips;
  give them a visible edge/fade or keep all labels visible;
- the fixed menu/chat buttons are 52 px circles at the bottom corners; the
  footer reserves 96 px plus the safe-area inset;
- no content is clipped under them at the bottom of the page.

Small-phone rules:

- `<= 380 px`: the composer privacy note moves to its own line.
- The top bar keeps only the Activity bell, language/currency and the account
  menu. Chat lives in the floating chat launcher and Meetups in the app menu /
  sidebar; do not add them back as top-bar icons.
- 320 px is treated as a hard minimum; if a new component cannot fit, wrap it
  or move it into a sheet — do not hide its text under `overflow: hidden`.

## 9. iOS readiness

The same HTML/CSS should run in a `WKWebView` without a second design.

- `viewport-fit=cover` is already set; use `env(safe-area-inset-*)` for the
  top bar, bottom controls and footer.
- Use `100dvh` (not `100vh`) for full-height sheets; already done for chat.
- Do not rely on hover to reveal an action. Hover previews are enhancement
  only; the same action must be available by tap.
- Keep form fields at 16 px so Safari does not zoom.
- Avoid Android-specific JavaScript in shared UI. Feature-detect any native
  bridge (`window.StreetNative` etc.) and keep a browser fallback.
- The WebView shell owns status-bar colour and the native back gesture; the
  page must keep a readable sticky top bar and a clear back link.
- Notifications: browser Web Push remains the fallback; the iOS native shell
  will use APNs later, behind the same server-side notification fan-out.

## 10. Definition of done for a UI change

- [ ] Uses the tokens or an existing component; no new one-off button/avatar.
- [ ] Page header uses `.pagehead__main` and `.pagehead__actions`.
- [ ] Avatar from `avatar.ejs`, allowed size, square, `object-fit: cover`.
- [ ] No fixed height around text; long Georgian copy wraps.
- [ ] Checked at 390 × 844 and 430 × 932.
- [ ] No page horizontal overflow.
- [ ] Footer links and last actions clear the fixed menu/chat buttons.
- [ ] Keyboard focus visible; icon-only controls have `aria-label`.
- [ ] Reduced-motion mode leaves the page usable; no action depends on hover.
- [ ] `npm run ui:check` passes.
- [ ] `npm run ui:visual` passes at 390 × 844 and 1440 × 900, including the
      Georgian pass and serious/critical axe checks.
- [ ] `npm run smoke` passes.
- [ ] Version, changelog and Georgian translations updated for user-facing
      changes.

## 11. Where to change what

| Concern | File |
| --- | --- |
| Tokens, canonical component overrides, safe areas | `public/css/ui-system.css` |
| Existing theme variables and page styles | `public/css/style.css` |
| Shared page chrome | `views/layout.ejs`, `views/partials/nav.ejs` |
| Avatars | `views/partials/avatar.ejs` |
| Buttons / icons | `views/partials/icon.ejs`, `.btn` / `.iconbtn` in CSS |
| Empty states | `views/partials/empty.ejs` |
| Live examples | `views/admin/style-guide.ejs` (`/admin/style-guide`) |
| Release gate | `npm run ui:check`, `npm run ui:visual`, `npm run smoke` |
