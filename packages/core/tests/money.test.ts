import { describe, expect, it } from 'vitest';
import { formatMoney, toMinor } from '../src/model/money.js';

describe('toMinor', () => {
  it('parses a plain whole-dollar amount', () => {
    expect(toMinor('500')).toBe(50000);
  });

  it('parses a leading-minus decimal amount', () => {
    expect(toMinor('-94.00')).toBe(-9400);
  });

  it('treats an empty string as zero', () => {
    expect(toMinor('')).toBe(0);
  });

  it('parses a small leading-minus decimal amount', () => {
    expect(toMinor('-0.35')).toBe(-35);
  });

  it('strips thousands separators', () => {
    expect(toMinor('1,234.56')).toBe(123456);
  });

  it('parses a trailing-minus amount (credit-union convention)', () => {
    expect(toMinor('152.36-')).toBe(-15236);
  });

  it('never produces negative zero', () => {
    expect(Object.is(toMinor('-0.00'), -0)).toBe(false);
    expect(toMinor('-0.00')).toBe(0);
  });

  it('pads a short fractional part', () => {
    expect(toMinor('10.5')).toBe(1050);
  });

  it('strips currency symbols', () => {
    expect(toMinor('$1,234.56')).toBe(123456);
    expect(toMinor('R2996.17')).toBe(299617);
  });
});

describe('formatMoney', () => {
  it('formats USD minor units', () => {
    expect(formatMoney(9400, 'USD', 'en-US')).toBe('$94.00');
  });

  it('formats ZAR minor units with the en-ZA locale', () => {
    // Non-breaking space between symbol and amount is standard for en-ZA Intl output.
    expect(formatMoney(299617, 'ZAR', 'en-ZA')).toMatch(/R\s?2\s?996,17|R\s?2,996\.17/);
  });

  it('formats negative amounts', () => {
    expect(formatMoney(-9400, 'USD', 'en-US')).toBe('-$94.00');
  });
});
