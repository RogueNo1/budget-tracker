import { describe, expect, it } from 'vitest';
import { newId } from '../src/model/id.js';

describe('newId', () => {
  it('generates a valid UUID v4', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('generates unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });
});
