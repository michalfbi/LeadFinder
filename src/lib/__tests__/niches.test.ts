import { describe, it, expect } from 'vitest';
import { MEGA_NICHES_CATEGORIES, ALL_NICHES, findNiche, nicheValue } from '../niches-catalog';

describe('Mega-słownik 40 nisz', () => {
  it('zawiera dokładnie 8 kategorii i 40 nisz', () => {
    expect(MEGA_NICHES_CATEGORIES).toHaveLength(8);
    expect(ALL_NICHES).toHaveLength(40);
  });
  it('każda nisza ma unikalne id, etykietę, ikonę, frazę i kody PKD', () => {
    const ids = new Set<string>();
    for (const n of ALL_NICHES) {
      expect(n.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(n.id)).toBe(false);
      ids.add(n.id);
      expect(n.label.length).toBeGreaterThan(2);
      expect(n.icon.length).toBeGreaterThan(0);
      expect(n.searchQuery.length).toBeGreaterThan(3);
      expect(n.pkd).toMatch(/^\d{2}\.\d{2}\.[A-Z](, \d{2}\.\d{2}\.[A-Z])*$/);
    }
  });
  it('nicheValue zwraca frazę dla Map/OLX, a kody PKD dla CEIDG', () => {
    const n = findNiche('foto-slub');
    expect(n).toBeDefined();
    expect(nicheValue(n!, 'GOOGLE_MAPS')).toBe(n!.searchQuery);
    expect(nicheValue(n!, 'OLX')).toBe(n!.searchQuery);
    expect(nicheValue(n!, 'CEIDG')).toBe('74.20.Z');
  });
});
