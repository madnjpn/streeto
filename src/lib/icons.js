/**
 * The inline SVG icon set.
 *
 * No external icon font, so the icons work offline and under a strict
 * Content-Security-Policy. The admin console shows the same list when it
 * asks which icon an article should carry.
 */
export const ICONS = {
  wall: '<path d="M3 9.5 12 3l9 6.5V21H3z"/><path d="M9 21v-6h6v6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16.4 5.7a3.2 3.2 0 0 1 0 6.3"/><path d="M17.6 14.3a6.5 6.5 0 0 1 3.9 5.7"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.2-4.2A8 8 0 1 1 21 12z"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 4 1.4 5.6 1.4 5.6h-14.8S6 13 6 9z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  pin: '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  gps: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.4"/><path d="M12 1.6v3M12 19.4v3M1.6 12h3M19.4 12h3"/>',
  alert: '<path d="M12 3.6 22 20H2z"/><path d="M12 9.6v4.6"/><path d="M12 17.3h.01"/>',
  heart: '<path d="M12 20.2S4.5 15.6 4.5 10.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 3.2c0 5-7.5 9.6-7.5 9.6z"/>',
  comment: '<path d="M20.5 11.5c0 4-3.8 7-8.5 7-1 0-2-.1-2.9-.4L4 20.5l1.4-3.9A6.7 6.7 0 0 1 3.5 11.5c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7z"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="m6.5 7 .9 12.5h9.2L17.5 7"/><path d="M10.5 11v5M13.5 11v5"/>',
  settings: '<path d="M4 7h9M17.5 7H20M4 17h2.5M11 17h9"/><circle cx="15" cy="7" r="2.4"/><circle cx="8.5" cy="17" r="2.4"/>',
  logout: '<path d="M15 4h3.5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H15"/><path d="m10 8-4 4 4 4"/><path d="M6 12h9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.8"/><path d="m4 17.5 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="m15 11.5 6-3.5v8l-6-3.5z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.4v3M16 3.4v3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3 2"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="2.5"/><path d="M8 10V7.6a4 4 0 0 1 8 0V10"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.6 3.4 5.5 3.4 8.5S14.4 18 12 20.5C9.6 18 8.6 15 8.6 12s1-5.9 3.4-8.5z"/>',
  send: '<path d="M21 3.5 3 10.8l7.2 2.6 2.6 7.1L21 3.5z"/><path d="m10.2 13.4 10.4-9.4"/>',
  flag: '<path d="M6 3v18"/><path d="M6 4.4h11.5l-2.2 4.1 2.2 4.1H6z"/>',
  check: '<path d="m5 13 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  minus: '<path d="M5 12h14"/>',
  paperclip: '<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5"/>',
  expand: '<path d="M8.5 3H4.5a1 1 0 0 0-1 1v4M15.5 3h4a1 1 0 0 1 1 1v4M20.5 15.5v4a1 1 0 0 1-1 1h-4M3.5 15.5v4a1 1 0 0 0 1 1h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  car: '<path d="M4.5 16.4v-2.9l1.9-4.9h11.2l1.9 4.9v2.9"/><path d="M3.2 16.4h17.6"/><circle cx="7.6" cy="17.6" r="1.7"/><circle cx="16.4" cy="17.6" r="1.7"/><path d="M6.6 13.1h10.8"/>',
  garage: '<path d="M3.5 20.5V9.5L12 4l8.5 5.5v11Z"/><path d="M6.6 20.5v-6.8h10.8v6.8"/><path d="M6.6 15.9h10.8"/><path d="M6.6 18.2h10.8"/>',
  bolt: '<path d="M13.5 3 5 13.6h6L10.5 21 19 10.4h-6z"/>',
  star: '<path d="m12 4 2.4 4.9 5.6.8-4 3.9 1 5.4-5-2.6-5 2.6 1-5.4-4-3.9 5.6-.8z"/>',
  back: '<path d="M10.5 5 3.5 12l7 7"/><path d="M3.5 12h17"/>',
  chevron: '<path d="m6 9.5 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  helmet: '<path d="M4 15.5a8 8 0 0 1 16 0"/><path d="M2.5 15.5h19v2.6h-19z"/><path d="M12 7.5v8"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4.5 8 7.5 5.2L19.5 8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12.2 9.2-9.2"/><path d="m16.6 6.6 2 2"/><path d="m13.8 9.4 2 2"/>',
  share: '<path d="M12 3.5v11"/><path d="m8 7.5 4-4 4 4"/><path d="M5 14v4.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V14"/>',
  shield: '<path d="M12 3.2 20 6v6.2c0 4.9-3.4 7.9-8 9.1-4.6-1.2-8-4.2-8-9.1V6z"/>',
  fire: '<path d="M12 21c3.9 0 6.5-2.6 6.5-6 0-4.5-4-6-6.5-12-2.5 6-6.5 7.5-6.5 12 0 3.4 2.6 6 6.5 6z"/><path d="M12 21c1.6 0 2.7-1.1 2.7-2.6 0-1.9-1.7-2.6-2.7-5.1-1 2.5-2.7 3.2-2.7 5.1C9.3 19.9 10.4 21 12 21z"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  download: '<path d="M12 3.5v11"/><path d="m8 10.5 4 4 4-4"/><path d="M5 19.5h14"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  tag: '<path d="M3.5 11.5V4.5a1 1 0 0 1 1-1h7l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  store: '<path d="M4 9.5 5 4h14l1 5.5"/><path d="M4 9.5h16"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-5h5v5"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>',
  camera: '<rect x="4" y="4" width="16" height="14" rx="2"/><path d="M12 8a4 4 0 0 1 4 4H8a4 4 0 0 1 4-4z"/><circle cx="12" cy="8" r="1.5"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h1.9a4.2 4.2 0 0 0 4.2-4.2C20.5 6.9 16.7 3.5 12 3.5z"/><circle cx="7.6" cy="11.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="17.4" cy="11.2" r="1.1" fill="currentColor" stroke="none"/>',
  exchange: '<path d="M3.5 8.5h13"/><path d="m13 5 3.5 3.5L13 12"/><path d="M20.5 15.5h-13"/><path d="m11 12 3.5 3.5L11 19"/>',
  card: '<rect x="2.8" y="5.2" width="18.4" height="13.6" rx="2.6"/><path d="M2.8 9.6h18.4"/><path d="M6.4 14.6h3.4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'
};

export const ICON_NAMES = Object.keys(ICONS);

export default { ICONS, ICON_NAMES };
