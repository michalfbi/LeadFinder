import catalog from '../../niches-catalog.json';

export type NicheItem = { id: string; label: string; icon: string; searchQuery: string; pkd: string };
export type NicheCategory = { id: string; label: string; icon: string; niches: NicheItem[] };

/** Mega-słownik 40 nisz w 8 kategoriach — współdzielony z Electronem (niches-catalog.json). */
export const MEGA_NICHES_CATEGORIES = catalog.categories as NicheCategory[];

export const ALL_NICHES: NicheItem[] = MEGA_NICHES_CATEGORIES.flatMap(c => c.niches);

export function findNiche(id: string): NicheItem | undefined {
  return ALL_NICHES.find(n => n.id === id);
}

export function findNicheCategory(nicheId: string): NicheCategory | undefined {
  return MEGA_NICHES_CATEGORIES.find(c => c.niches.some(n => n.id === nicheId));
}

/** Wartość wpisywana do pola wyszukiwania: fraza dla Map/OLX, kody PKD dla CEIDG. */
export function nicheValue(niche: NicheItem, source: 'GOOGLE_MAPS' | 'CEIDG' | 'OLX' | 'maps' | 'ceidg' | 'olx'): string {
  return source === 'CEIDG' || source === 'ceidg' ? niche.pkd : niche.searchQuery;
}
