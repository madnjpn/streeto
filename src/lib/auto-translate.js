import { translate } from '@vitalets/google-translate-api';

/**
 * Machine-translate one English interface key into Georgian.
 *
 * This is a convenience for the admin translator, not a replacement for
 * review: placeholders and HTML tags survive Google's translation, and
 * the normal translation validator still checks every result before it
 * is saved.
 */
export async function autoTranslateToGeorgian(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('Nothing to translate.');

  const result = await translate(source, { from: 'en', to: 'ka' });
  const value = String(result?.text ?? '').trim();
  if (!value) throw new Error('The translation was empty.');
  return value;
}

export default { autoTranslateToGeorgian };
