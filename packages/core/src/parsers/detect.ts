import { CAPITEC_HEADERS } from './capitecCsv.js';

export type DetectedFormat = 'pdf' | 'capitecCsv';

export class UnknownFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownFormatError';
  }
}

/** First bytes of every PDF file, per the PDF spec. */
const PDF_MAGIC = '%PDF-';

function bytesToAsciiPrefix(bytes: Uint8Array, length: number): string {
  let s = '';
  for (let i = 0; i < Math.min(length, bytes.length); i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return s;
}

/**
 * Detect whether a file is a PDF (magic bytes) or a Capitec CSV export
 * (first-line header signature). Anything else throws a typed error with
 * user-facing guidance rather than silently mis-parsing.
 */
export function detectFormat(bytes: Uint8Array, textPreview?: string): DetectedFormat {
  if (bytesToAsciiPrefix(bytes, PDF_MAGIC.length) === PDF_MAGIC) {
    return 'pdf';
  }

  const preview = textPreview ?? bytesToAsciiPrefix(bytes, 2048);
  const firstLine = (preview.split(/\r\n|\r|\n/)[0] ?? '').trim();
  const headerCols = firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const hasAllCapitecColumns = CAPITEC_HEADERS.every((h) => headerCols.includes(h));

  if (hasAllCapitecColumns) {
    return 'capitecCsv';
  }

  throw new UnknownFormatError(
    `Couldn't recognize this file format. Expected either a PDF bank statement, or a CSV ` +
      `with the Capitec export columns: ${CAPITEC_HEADERS.join(', ')}.`,
  );
}
