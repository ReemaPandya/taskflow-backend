import { describe, expect, it } from 'vitest';
import { getPagination } from '../../src/lib/pagination';

describe('getPagination', () => {
  it('uses defaults', () => expect(getPagination()).toEqual({ page: 1, limit: 20, skip: 0 }));
  it('caps limit at 100 and computes offset', () => expect(getPagination(3, 500)).toEqual({ page: 3, limit: 100, skip: 200 }));
  it('normalizes invalid values', () => expect(getPagination(-2, 0)).toEqual({ page: 1, limit: 20, skip: 0 }));
});
