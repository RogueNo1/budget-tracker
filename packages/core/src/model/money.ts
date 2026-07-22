/**
 * Money is always integer minor units (cents) in storage. Never parseFloat
 * for storage — both prototypes accumulate float error doing exactly that.
 * Convert at the parser boundary (toMinor) and format at the display
 * boundary (formatMoney) with Intl.NumberFormat and the transaction's own
 * currency.
 */

/** Accumulate a run of ASCII digits into an integer without parseFloat/parseInt. */
function digitsToInt(digits: string): number {
  let result = 0;
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    const d = code - 48; // '0' === 48
    if (d < 0 || d > 9) continue;
    result = result * 10 + d;
  }
  return result;
}

/**
 * Parse a decimal amount string into integer minor units (cents).
 * Handles:
 *  - empty string -> 0
 *  - thousands separators: "1,234.56"
 *  - leading minus: "-94.00"
 *  - trailing minus (credit-union convention): "152.36-"
 *  - currency symbols / stray whitespace, stripped before parsing
 *  - missing/short fractional part, padded to 2 digits
 */
export function toMinor(decimalString: string): number {
  const raw = decimalString.trim();
  if (raw === '') return 0;

  let negative = false;
  let s = raw;

  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }

  // Strip currency symbols and anything that isn't a digit, comma, or dot.
  s = s.replace(/[^0-9.,]/g, '');
  // Thousands separators.
  s = s.replace(/,/g, '');

  if (s === '' || s === '.') return 0;

  const parts = s.split('.');
  const intPartRaw = parts[0] ?? '';
  const fracPartRaw = parts[1] ?? '';
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const fracPart = (fracPartRaw + '00').slice(0, 2);

  const minor = digitsToInt(intPart) * 100 + digitsToInt(fracPart);
  return negative && minor !== 0 ? -minor : minor;
}

/** Format integer minor units for display using the transaction's own currency/locale. */
export function formatMoney(minorUnits: number, currency: string, locale = 'en-US'): string {
  const decimal = minorUnits / 100;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(decimal);
}
