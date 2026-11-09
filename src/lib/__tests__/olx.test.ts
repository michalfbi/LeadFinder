import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { collectOffers, offerDetail } = require('../../../electron/olx-results.cjs');
const row = (id: number) => ({ id, title: `Oferta ${id}`, url: `https://www.olx.pl/d/oferta/test-ID${id}.html` });

describe('OLX full result collection', () => {
  it('collects 50 unique offers across pages from nested API arrays', async () => {
    const offsets: number[] = [];
    const result = await collectOffers({ fetchPage: async (offset: number) => {
      offsets.push(offset);
      return { data: { data: Array.from({ length: 40 }, (_, i) => row(offset + i)) } };
    } });
    expect(offsets).toEqual([0, 40]);
    expect(result).toHaveLength(50);
    expect(result[49].id).toBe(49);
  });
  it('unwraps the full description from the detail response', () => {
    expect(offerDetail({ data: { description: 'Telefon 601234567' } }, row(1)).description).toBe('Telefon 601234567');
    expect(offerDetail({ data: { data: { description: 'Telefon 512345678' } } }, row(2)).description).toBe('Telefon 512345678');
  });
  it('merges every DOM result when API fails, without repeating offers', async () => {
    const result = await collectOffers({ fetchPage: async () => null,
      fetchDomPage: async (page: number) => page <= 2 ? Array.from({ length: 30 }, (_, i) => row((page - 1) * 25 + i)) : [] });
    expect(result).toHaveLength(50);
    expect(new Set(result.map((o: { id: number }) => o.id)).size).toBe(50);
  });
  it('validates every harvested phone, excludes blacklist and deduplicates across offers', async () => {
    const source = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf8');
    const scanner = source.slice(source.indexOf('async function searchOlx('), source.indexOf('ipcMain.handle("olx:search"'));
    const phones = ['601234567', '+48601234567', '512345678', '221234567', '723456789'];
    const { parsePhoneNumberFromString } = require('libphonenumber-js/max');
    const validate = (raw: string) => {
      const parsed = parsePhoneNumberFromString(raw, 'PL');
      return { isValidMobile: parsed?.isValid() && parsed?.getType() === 'MOBILE', formatted: parsed?.number };
    };
    const context = vm.createContext({ URLSearchParams, Set, Math, String, Number,
      collectOffers: async () => phones.map((_, i) => row(i)),
      offerDetail, olxApiGet: async () => null, olxReadDom: async () => '',
      blockDb: () => ({ prepare: () => ({ all: () => [{ phone: '+48512345678' }] }) }),
      blacklistKey: (raw: string) => String(raw).replace(/\D/g, '').slice(-9),
      findMobileInText: () => phones.shift(), validatePolishMobile: validate,
      olxLinksInDescription: () => ({ ownSite: null, socialOnly: false }), sleep: async () => {}, OLX_CLICK_BUDGET: 50,
    });
    vm.runInContext(`${scanner}; globalThis.scan = searchOlx;`, context);
    const result = await context['scan']({ sender: { send() {} } }, { query: 'fotograf' });
    expect(result.leads.map((l: { telefon: string }) => l.telefon)).toEqual(['+48601234567', '+48723456789']);
    expect(result.rejectedPhones).toBe(1);
  });
  it('processes all 50 offers requiring phone reveal rather than stopping at 12', async () => {
    const source = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf8');
    const scanner = source.slice(source.indexOf('async function searchOlx('), source.indexOf('ipcMain.handle("olx:search"'));
    let revealed = 0;
    const context = vm.createContext({ URLSearchParams, Set, Math, String, Number,
      collectOffers: async () => Array.from({ length: 50 }, (_, i) => row(i)),
      offerDetail, olxApiGet: async () => null, olxReadDom: async () => '', cacheDb: () => null,
      blacklistKey: (raw: string) => raw.replace(/\D/g, '').slice(-9),
      findMobileInText: () => null,
      olxRevealPhone: async () => ({ ok: true, phone: `+48600123${String(revealed++).padStart(3, '0')}` }),
      validatePolishMobile: (raw: string) => ({ isValidMobile: true, formatted: raw }),
      olxLinksInDescription: () => ({ ownSite: null, socialOnly: false }), sleep: async () => {}, OLX_CLICK_BUDGET: 50,
    });
    vm.runInContext(`${scanner}; globalThis.scan = searchOlx;`, context);
    const result = await context['scan']({ sender: { send() {} } }, { query: 'fotograf' });
    expect(revealed).toBe(50);
    expect(result.leads).toHaveLength(50);
    expect(result.clicked).toBe(50);
  });
});