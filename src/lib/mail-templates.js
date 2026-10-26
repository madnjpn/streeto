/**
 * The letters the site sends.
 *
 * Email clients are a museum: no flexbox, no <style> worth trusting, no
 * border-radius in Outlook. Everything below is a table with inline CSS,
 * 600px wide, and it degrades to something readable when the pictures are
 * blocked - the wordmark is the only image, the rest is text.
 *
 * The header copies the left panel of the login screen: the same diagonal
 * hairlines, the same two neon glows over a dark gradient. Gmail draws the
 * gradients; Outlook drops them and keeps the solid background, which
 * still looks right.
 *
 * Every sentence goes through `t`, so the wording lives on the
 * TRANSLATIONS page like the rest of the site.
 */

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * Escapes the text but keeps a line break.
 *
 * A few site strings carry a `<br>` (the "BACK ON THE ASPHALT" line on
 * the login screen); in a letter that has to stay a real line break and
 * not the letters "<br>".
 */
const escLines = (value) => esc(value).replace(/&lt;br\s*\/?&gt;/gi, '<br>');

/* Street palette, the same as the dark theme. */
const INK = '#06070a';
const PANEL = '#0d1017';
const LINE = '#1b2230';
const BODY = '#a9b3c2';
const HEAD = '#f4f7fb';
const ACCENT = '#2fe9ff';
const ON_ACCENT = '#04121a';

/* The site sets Manrope from Google Fonts; a mail client will not fetch a
   web font, so it is named first (for the few that have it installed) and
   the system faces behind it do the real work. */
const FONT = "Manrope,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',SFMono-Regular,Consolas,Menlo,monospace";

/* The login panel, rebuilt as background layers. */
const ART = [
  'repeating-linear-gradient(115deg, transparent 0 26px, rgba(255,255,255,0.035) 26px 27px)',
  'radial-gradient(circle at 15% 5%, rgba(47,233,255,0.22), transparent 55%)',
  'radial-gradient(circle at 90% 95%, rgba(15,184,221,0.18), transparent 55%)',
  'linear-gradient(150deg, #0d121b, #05070c)',
].join(',');

/**
 * The password recovery letter.
 *
 * @param {object} data
 * @param {Function} data.t      translator (req.t)
 * @param {object} data.user     the account: username, display_name
 * @param {string} data.link     the one-time URL
 * @param {number} data.minutes  how long the link lives
 * @param {string} data.siteName e.g. STREETO
 * @param {string} data.siteUrl  https://streeto.net
 * @param {string} data.logoUrl  absolute URL of websitelogo.png
 */
export function resetEmail({ t, user, link, minutes, siteName, siteUrl, logoUrl, lang = 'en' }) {
  const username = String(user.username || '');
  const safeUser = esc(username);
  const safeLink = esc(link);
  const safeSite = esc(siteName);
  const safeSiteUrl = esc(siteUrl || '');
  const safeLogo = esc(logoUrl || '');

  const subject = t('{site} - set a new password', { site: siteName });

  /* Shown in the inbox list next to the subject, before the body loads. */
  const preheader = t('A new password was asked for @{user}. The link works once.', {
    user: username,
  });

  const html = `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${INK};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:40px 12px 34px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

        <!-- the login panel -->
        <tr>
          <td bgcolor="#0a0d13" style="background-color:#0a0d13;background-image:${ART};border:1px solid ${LINE};border-bottom:0;border-radius:16px 16px 0 0;padding:34px 34px 30px;">
            <a href="${safeSiteUrl}" style="text-decoration:none;border:0;">
              <img src="${safeLogo}" width="148" alt="${safeSite}" style="display:block;width:148px;max-width:148px;height:auto;border:0;outline:none;text-decoration:none;">
            </a>

            <p style="margin:26px 0 10px 0;font-family:${FONT};font-size:10px;line-height:14px;letter-spacing:2.6px;text-transform:uppercase;color:${ACCENT};font-weight:700;">
              ${esc(t('account recovery'))}
            </p>

            <h1 style="margin:0;font-family:${FONT};font-size:29px;line-height:36px;color:${HEAD};font-weight:800;letter-spacing:0.4px;text-transform:uppercase;">
              ${t('BACK ON<br>THE ASPHALT')}
            </h1>

            <div style="margin:22px 0 0 0;width:54px;height:3px;line-height:3px;font-size:0;background:${ACCENT};border-radius:3px;">&nbsp;</div>
          </td>
        </tr>

        <!-- the letter itself -->
        <tr>
          <td style="background:${PANEL};border:1px solid ${LINE};border-top:0;border-radius:0 0 16px 16px;padding:32px 34px 30px;">

            <h2 style="margin:0 0 14px 0;font-family:${FONT};font-size:21px;line-height:29px;color:${HEAD};font-weight:800;letter-spacing:-0.1px;">
              ${esc(t('Set a new password'))}
            </h2>

            <p style="margin:0 0 22px 0;font-family:${FONT};font-size:15px;line-height:25px;color:${BODY};">
              ${esc(t('A new password was asked for the account @{user} on {site}.', { user: username, site: siteName }))}
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
              <tr>
                <td align="center" bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:999px;padding:15px 34px;">
                  <a href="${safeLink}" style="display:inline-block;font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:0.2px;color:${ON_ACCENT};text-decoration:none;">
                    ${esc(t('Choose a new password'))}
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 26px 0;font-family:${FONT};font-size:13px;line-height:21px;color:#7d8797;">
              ${esc(t('The link is good for {minutes} minutes and works once.', { minutes }))}
            </p>

            <div style="height:1px;line-height:1px;font-size:0;background:${LINE};margin:0 0 22px 0;">&nbsp;</div>

            <p style="margin:0 0 10px 0;font-family:${FONT};font-size:12px;line-height:19px;color:#7d8797;">
              ${esc(t('Or copy this address into the browser:'))}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#080b11" style="background:#080b11;border:1px solid ${LINE};border-radius:10px;padding:13px 15px;">
                  <a href="${safeLink}" style="font-family:${MONO};font-size:12px;line-height:19px;color:#9fb0c4;text-decoration:none;word-break:break-all;">${safeLink}</a>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0 0;font-family:${FONT};font-size:13px;line-height:21px;color:${BODY};">
              ${esc(t('If it was not you, do nothing - the password stays as it is.'))}
            </p>

          </td>
        </tr>

        <tr>
          <td align="center" style="padding:26px 8px 0 8px;">
            <p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:19px;color:#5d6675;">
              ${esc(t('{site} - the streets, in one place.', { site: siteName }))}
            </p>
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:19px;color:#5d6675;">
              <a href="${safeSiteUrl}" style="color:${ACCENT};text-decoration:none;">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    `${siteName}`,
    '',
    t('Set a new password'),
    '',
    t('A new password was asked for the account @{user} on {site}.', {
      user: username,
      site: siteName,
    }),
    '',
    link,
    '',
    t('The link is good for {minutes} minutes and works once.', { minutes }),
    t('If it was not you, do nothing - the password stays as it is.'),
    '',
    siteUrl.replace(/^https?:\/\//, ''),
  ].join('\n');

  return { subject, html, text, preheader, username: safeUser };
}

/**
 * The weekly letter.
 *
 * What happened on the site while the member was away: their build was
 * voted for, somebody answered them, there is a part on the board for
 * their car, a meetup is coming. The same letter, the same look as the
 * reset letter.
 *
 * @param {object} data
 * @param {Function} data.t    translator
 * @param {object} data.user   the member (username, display_name)
 * @param {Array}  data.sections  [{ title, items: [{ text, url }] }]
 * @param {string} data.siteName
 * @param {string} data.siteUrl
 * @param {string} data.logoUrl
 */
export function digestEmail({ t, user, sections, siteName, siteUrl, logoUrl, lang = 'en' }) {
  const username = String(user.username || '');
  const safeSite = esc(siteName);
  const safeSiteUrl = esc(siteUrl || '');
  const safeLogo = esc(logoUrl || '');

  const subject = t('{site} - your week on the street', { site: siteName });
  const preheader = t('What happened on {site} while you were away.', { site: siteName });

  const block = (section) => `
            <tr>
              <td style="padding:0 0 6px 0;">
                <p style="margin:0 0 10px 0;font-family:${FONT};font-size:11px;line-height:16px;letter-spacing:2.2px;text-transform:uppercase;color:${ACCENT};font-weight:700;">
                  ${esc(section.title)}
                </p>
                ${section.items.map((item) => `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px 0;">
                  <tr>
                    <td style="padding:9px 12px;border:1px solid ${LINE};border-radius:10px;background:#0a0d13;">
                      ${item.url
                        ? `<a href="${esc(item.url)}" style="font-family:${FONT};font-size:14px;line-height:21px;color:${HEAD};text-decoration:none;">${esc(item.text)}</a>`
                        : `<span style="font-family:${FONT};font-size:14px;line-height:21px;color:${HEAD};">${esc(item.text)}</span>`}
                    </td>
                  </tr>
                </table>`).join('')}
              </td>
            </tr>`;

  const html = `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${INK};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:40px 12px 34px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

        <tr>
          <td bgcolor="#0a0d13" style="background-color:#0a0d13;background-image:${ART};border:1px solid ${LINE};border-bottom:0;border-radius:16px 16px 0 0;padding:34px 34px 30px;">
            <a href="${safeSiteUrl}" style="text-decoration:none;border:0;">
              <img src="${safeLogo}" width="148" alt="${safeSite}" style="display:block;width:148px;max-width:148px;height:auto;border:0;outline:none;text-decoration:none;">
            </a>
            <p style="margin:26px 0 10px 0;font-family:${FONT};font-size:10px;line-height:14px;letter-spacing:2.6px;text-transform:uppercase;color:${ACCENT};font-weight:700;">
              ${esc(t('Your week on the street'))}
            </p>
            <h1 style="margin:0;font-family:${FONT};font-size:29px;line-height:36px;color:${HEAD};font-weight:800;letter-spacing:0.4px;text-transform:uppercase;">
              ${escLines(t('BACK ON<br>THE ASPHALT'))}
            </h1>
          </td>
        </tr>

        <tr>
          <td style="background:${PANEL};border:1px solid ${LINE};border-top:0;border-radius:0 0 16px 16px;padding:28px 34px 30px;">
            <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${BODY};">
              ${esc(t('Hello @{user}, here is what happened while you were away.', { user: username }))}
            </p>
            ${sections.map(block).join('')}
            <div style="height:1px;line-height:1px;font-size:0;background:${LINE};margin:8px 0 20px 0;">&nbsp;</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:999px;padding:15px 34px;">
                  <a href="${safeSiteUrl}" style="display:inline-block;font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:0.2px;color:${ON_ACCENT};text-decoration:none;">
                    ${esc(t('Open {site}', { site: siteName }))}
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:22px 0 0 0;font-family:${FONT};font-size:12px;line-height:19px;color:#5d6675;">
              ${esc(t('You get this letter because you asked for it. You can turn it off in your settings.'))}
            </p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:26px 8px 0 8px;">
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:19px;color:#5d6675;">
              <a href="${safeSiteUrl}" style="color:${ACCENT};text-decoration:none;">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    `${siteName}`,
    '',
    t('Hello @{user}, here is what happened while you were away.', { user: username }),
    '',
    ...sections.flatMap((section) => [
      section.title,
      ...section.items.map((item) => `- ${item.text}${item.url ? ` (${item.url})` : ''}`),
      '',
    ]),
    siteUrl.replace(/^https?:\/\//, ''),
  ].join('\n');

  return { subject, html, text, preheader };
}

/**
 * The inspection reminder.
 *
 * The site already knows when a car has to go to the technical
 * inspection. This letter says so before the date, not after it.
 */
export function ptiReminderEmail({ t, user, cars, days, siteName, siteUrl, logoUrl, lang = 'en' }) {
  const username = String(user.username || '');
  const safeSite = esc(siteName);
  const safeSiteUrl = esc(siteUrl || '');
  const safeLogo = esc(logoUrl || '');

  const subject = days <= 0
    ? t('{site} - your inspection is due', { site: siteName })
    : t('{site} - your inspection expires in {days} days', { site: siteName, days });
  const preheader = t('Your car has to go to the technical inspection soon.', { site: siteName });

  const rows = cars.map((car) => `
              <tr>
                <td style="padding:9px 12px;border:1px solid ${LINE};border-radius:10px;background:#0a0d13;">
                  <span style="font-family:${FONT};font-size:14px;line-height:21px;color:${HEAD};">${esc(car.name)}</span>
                  <span style="font-family:${MONO};font-size:12px;line-height:21px;color:#7d8797;margin-left:8px;">${esc(car.plate || '')}</span>
                  <span style="font-family:${FONT};font-size:12px;line-height:21px;color:#7d8797;margin-left:8px;">${esc(car.expires || '')}</span>
                </td>
              </tr>`).join('');

  const html = `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${INK};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:40px 12px 34px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

        <tr>
          <td bgcolor="#0a0d13" style="background-color:#0a0d13;background-image:${ART};border:1px solid ${LINE};border-bottom:0;border-radius:16px 16px 0 0;padding:34px 34px 30px;">
            <a href="${safeSiteUrl}" style="text-decoration:none;border:0;">
              <img src="${safeLogo}" width="148" alt="${safeSite}" style="display:block;width:148px;max-width:148px;height:auto;border:0;outline:none;text-decoration:none;">
            </a>
            <p style="margin:26px 0 10px 0;font-family:${FONT};font-size:10px;line-height:14px;letter-spacing:2.6px;text-transform:uppercase;color:${ACCENT};font-weight:700;">
              ${esc(t('Technical inspection'))}
            </p>
            <h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:34px;color:${HEAD};font-weight:800;letter-spacing:0.4px;text-transform:uppercase;">
              ${days <= 0 ? esc(t('Time for the inspection')) : esc(t('Inspection in {days} days', { days }))}
            </h1>
          </td>
        </tr>

        <tr>
          <td style="background:${PANEL};border:1px solid ${LINE};border-top:0;border-radius:0 0 16px 16px;padding:28px 34px 30px;">
            <p style="margin:0 0 20px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${BODY};">
              ${esc(t('Hello @{user}, these cars have to go to the technical inspection soon.', { user: username }))}
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${rows}
            </table>
            <div style="height:1px;line-height:1px;font-size:0;background:${LINE};margin:20px 0 20px 0;">&nbsp;</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:999px;padding:15px 34px;">
                  <a href="${safeSiteUrl}" style="display:inline-block;font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:0.2px;color:${ON_ACCENT};text-decoration:none;">
                    ${esc(t('Open {site}', { site: siteName }))}
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:22px 0 0 0;font-family:${FONT};font-size:12px;line-height:19px;color:#5d6675;">
              ${esc(t('You get this letter because you asked for it. You can turn it off in your settings.'))}
            </p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:26px 8px 0 8px;">
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:19px;color:#5d6675;">
              <a href="${safeSiteUrl}" style="color:${ACCENT};text-decoration:none;">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    `${siteName}`,
    '',
    t('Hello @{user}, these cars have to go to the technical inspection soon.', { user: username }),
    '',
    ...cars.map((car) => `- ${car.name}${car.plate ? ` (${car.plate})` : ''}${car.expires ? ` - ${car.expires}` : ''}`),
    '',
    siteUrl.replace(/^https?:\/\//, ''),
  ].join('\n');

  return { subject, html, text, preheader };
}

export default { resetEmail, digestEmail, ptiReminderEmail };


/**
 * The summary of an Underground night.
 * One letter per approved driver when the host finishes the night.
 */
export function undergroundSummaryEmail({ t, user, event, runs, run, siteName, siteUrl, logoUrl, lang = 'en' }) {
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const title = safe(event.title);
  const type = safe(String(event.type || '').toUpperCase());
  const when = safe(new Date(event.starts_at).toLocaleString('en-GB'));
  const link = siteUrl ? siteUrl + '/underground/' + event.id : '/underground/' + event.id;
  const stat = (label, value) => '<tr><td style="padding:7px 0;color:#8b95a7;font-family:' + FONT + ';font-size:13px;">' + safe(label) + '</td><td align="right" style="padding:7px 0;color:#fff;font-family:' + FONT + ';font-size:14px;font-weight:700;">' + safe(value) + '</td></tr>';
  const list = Array.isArray(runs) ? runs : run ? [run] : [];
  const runStats = (one, index) => '<tr><td colspan="2" style="padding:16px 0 4px;color:#ff3b4d;font-family:' + MONO + ';font-size:10px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">' + safe(t('Run {n}', { n: index + 1 })) + '</td></tr>' +
    stat(t('Top speed'), Math.round(one.top_speed || 0) + ' km/h') +
    stat(t('Average speed'), Math.round(one.avg_speed || 0) + ' km/h') +
    stat(t('Distance'), Number(one.distance_km || 0).toFixed(2) + ' km') +
    (event.type === 'drag' ? stat(t('Acceleration'), Number(one.acceleration || 0).toFixed(2) + ' m/s2') : '') +
    stat(t('Duration'), Math.round(one.duration_s || 0) + ' s');
  const stats = list.length
    ? list.map(runStats).join('')
    : '<tr><td colspan="2" style="padding:14px 0;color:#8b95a7;font-family:' + FONT + ';font-size:13px;">' + safe(t('No run was recorded.')) + '</td></tr>';

  const html = '<!doctype html><html lang="' + safe(lang) + '"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"></head>' +
    '<body style="margin:0;padding:0;background:' + INK + ';">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + INK + ';padding:36px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">' +
    '<tr><td style="border:1px solid #2a1116;border-bottom:0;border-radius:16px 16px 0 0;padding:28px 30px;background:#090708;background-image:radial-gradient(circle at 10% 0%,rgba(255,59,77,.22),transparent 62%);">' +
    (logoUrl ? '<img src="' + safe(logoUrl) + '" width="150" alt="' + safe(siteName) + '" style="display:block;width:150px;height:auto;border:0;">' : '<strong style="color:#fff;font-family:' + FONT + ';font-size:20px;letter-spacing:2px;">' + safe(siteName) + '</strong>') +
    '<p style="margin:28px 0 8px;font-family:' + FONT + ';font-size:10px;letter-spacing:2.4px;color:#ff3b4d;font-weight:700;">UNDERGROUND / ' + type + '</p>' +
    '<h1 style="margin:0;font-family:' + FONT + ';font-size:28px;line-height:35px;color:#f7f7f8;">' + title + '</h1>' +
    '<p style="margin:10px 0 0;font-family:' + FONT + ';font-size:13px;color:#8b95a7;">' + when + '</p></td></tr>' +
    '<tr><td style="border:1px solid #2a1116;border-top:0;border-radius:0 0 16px 16px;background:#0d0d0f;padding:26px 30px;">' +
    '<h2 style="margin:0 0 12px;font-family:' + FONT + ';font-size:20px;color:#fff;">' + safe(t('Your Underground summary')) + '</h2>' +
    '<p style="margin:0 0 18px;font-family:' + FONT + ';font-size:14px;line-height:23px;color:#a5adba;">' + safe(t(list.length > 1 ? 'The night is over. Here are your runs.' : 'The night is over. Here is your run.')) + '</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #242428;border-bottom:1px solid #242428;">' + stats + '</table>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;"><tr><td bgcolor="#ff3b4d" style="border-radius:999px;padding:13px 26px;"><a href="' + safe(link) + '" style="font-family:' + FONT + ';font-size:14px;font-weight:800;color:#140609;text-decoration:none;">' + safe(t('Open My Underground')) + '</a></td></tr></table>' +
    '<p style="margin:22px 0 0;font-family:' + FONT + ';font-size:12px;line-height:19px;color:#6f7888;">' + safe(t('Your run is saved in My Underground. The host will finish the night when everyone is done.')) + '</p>' +
    '</td></tr></table></td></tr></table></body></html>';

  const text = t('Underground summary: {title}', { title: event.title }) + '\n' +
    t('Your Underground summary') + '\n' +
    (list.length
      ? list.map((one, index) => t('Run {n}', { n: index + 1 }) + '\n' + [
        t('Top speed') + ': ' + Math.round(one.top_speed || 0) + ' km/h',
        t('Average speed') + ': ' + Math.round(one.avg_speed || 0) + ' km/h',
        t('Distance') + ': ' + Number(one.distance_km || 0).toFixed(2) + ' km',
      ].join('\n')).join('\n\n')
      : t('No run was recorded.')) + '\n' + link;

  return { subject: t('Underground summary: {title}', { title: event.title }), html, text };
}
