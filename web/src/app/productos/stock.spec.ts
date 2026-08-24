import { describe, expect, it } from 'vitest';
import { LOW_STOCK, stockOf } from './stock';

describe('stockOf', () => {
  it('sums every variant', () => {
    expect(stockOf([{ stock: 3 }, { stock: 4 }, { stock: 5 }])).toEqual({ stock: 12, level: 'ok' });
  });

  it('calls nothing left "out"', () => {
    expect(stockOf([{ stock: 0 }, { stock: 0 }])).toEqual({ stock: 0, level: 'out' });
    expect(stockOf([])).toEqual({ stock: 0, level: 'out' });
  });

  it('warns at the threshold and below, but not above it', () => {
    expect(stockOf([{ stock: LOW_STOCK }]).level).toBe('low');
    expect(stockOf([{ stock: LOW_STOCK - 1 }]).level).toBe('low');
    expect(stockOf([{ stock: LOW_STOCK + 1 }]).level).toBe('ok');
  });

  it('is the total that decides, not any single variant', () => {
    // Three variants of two units each is six in stock, which is not low.
    expect(stockOf([{ stock: 2 }, { stock: 2 }, { stock: 2 }])).toEqual({ stock: 6, level: 'ok' });
  });

  it('treats a missing or junk quantity as zero rather than producing NaN', () => {
    const variants = [{ stock: 4 }, { stock: undefined }, { stock: 'x' }] as unknown as {
      stock: number;
    }[];
    expect(stockOf(variants)).toEqual({ stock: 4, level: 'low' });
  });
});
