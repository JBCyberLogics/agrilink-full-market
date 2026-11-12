import { describe, expect, it } from 'vitest';
import { PAGES } from './navigation';
import { canOpenPage } from './pagePermissions';

const page = (id: string) => PAGES.find((item) => item.id === id)!;

describe('administrator page permissions', () => {
  it('requires every permission used by the combined orders and payments view', () => {
    expect(canOpenPage(page('transactions'), ['orders.read'])).toBe(false);
    expect(canOpenPage(page('transactions'), ['payments.read'])).toBe(false);
    expect(canOpenPage(page('transactions'), ['orders.read', 'payments.read'])).toBe(true);
  });

  it('distinguishes AI configuration from read access', () => {
    expect(canOpenPage(page('nvidia'), ['ai.read'])).toBe(true);
    expect(canOpenPage(page('ai-diagnostics'), ['ai.read'])).toBe(false);
    expect(canOpenPage(page('ai-diagnostics'), ['ai.configure'])).toBe(true);
  });

  it('denies pages when the server returned no permission grants', () => {
    expect(PAGES.every((item) => !canOpenPage(item, []))).toBe(true);
  });
});
