import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UnknownFormatError, detectFormat } from '../src/parsers/detect.js';

const wa0002Path = fileURLToPath(
  new URL('../../../tests/fixtures/csv/DOC-20260316-WA0002.csv', import.meta.url),
);
const wa0002Csv = readFileSync(wa0002Path, 'utf-8');
const wa0002Bytes = readFileSync(wa0002Path);

describe('detectFormat', () => {
  it('detects PDF via magic bytes', () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n...');
    expect(detectFormat(pdfBytes)).toBe('pdf');
  });

  it('detects the real WA0002 Capitec CSV by header signature', () => {
    expect(detectFormat(new Uint8Array(wa0002Bytes), wa0002Csv)).toBe('capitecCsv');
  });

  it('detects a Capitec CSV even with columns in a different order', () => {
    const reordered =
      'Balance,Fee,Money Out,Money In,Category,Parent Category,Original Description,Description,Transaction Date,Posting Date,Account,Nr\n100.00,,,10.00,Cat,Cat,Test,Test,,2026-01-01,123,1\n';
    const bytes = new TextEncoder().encode(reordered);
    expect(detectFormat(bytes, reordered)).toBe('capitecCsv');
  });

  it('throws a typed UnknownFormatError with guidance for an unrecognized file', () => {
    const bytes = new TextEncoder().encode('just,some,random,csv\n1,2,3,4\n');
    expect(() => detectFormat(bytes, 'just,some,random,csv\n1,2,3,4\n')).toThrow(
      UnknownFormatError,
    );
  });
});
