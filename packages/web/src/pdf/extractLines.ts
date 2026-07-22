import * as pdfjsLib from 'pdfjs-dist';

// Local worker file (public/pdf.worker.min.js) — not a CDN URL, so this
// works offline and isn't subject to a third-party host going away.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

interface TextItemPos {
  text: string;
  x: number;
  y: number;
}

/**
 * Load a PDF (as bytes) and extract its text as top-to-bottom,
 * left-to-right lines, one string per visual row.
 *
 * Ported from budget-ledger.html's extractLines: text items are bucketed by
 * y-position (±2pt, to absorb tiny baseline jitter within one printed row),
 * each bucket is sorted left-to-right by x, and buckets are emitted
 * top-to-bottom (descending y — PDF space has y increasing upward).
 *
 * This is intentionally the only part of the PDF pipeline that touches
 * pdf.js/the DOM; packages/core/src/parsers/pdfStatement.ts takes the
 * string[] this produces and does the actual (pure, testable) parsing.
 */
export async function extractLines(fileBytes: ArrayBuffer): Promise<string[]> {
  const loadingTask = pdfjsLib.getDocument({ data: fileBytes });
  const pdf = await loadingTask.promise;
  const lines: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const items: TextItemPos[] = content.items
      .filter((it): it is typeof it & { str: string; transform: number[] } => 'str' in it)
      .map((it) => ({ text: it.str, x: it.transform[4] as number, y: it.transform[5] as number }))
      .filter((it) => it.text.trim().length > 0);

    const rows: Record<number, TextItemPos[]> = {};
    items.forEach((it) => {
      const key = Math.round(it.y);
      let bucket = key;
      const existingKeys = Object.keys(rows).map(Number);
      const near = existingKeys.find((k) => Math.abs(k - key) <= 2);
      if (near !== undefined) bucket = near;
      if (!rows[bucket]) rows[bucket] = [];
      rows[bucket]!.push(it);
    });

    const sortedKeys = Object.keys(rows)
      .map(Number)
      .sort((a, b) => b - a); // descending y = top of page first

    sortedKeys.forEach((k) => {
      const rowItems = rows[k]!.sort((a, b) => a.x - b.x);
      const text = rowItems
        .map((i) => i.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) lines.push(text);
    });
  }

  return lines;
}
