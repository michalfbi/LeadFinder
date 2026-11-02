import { useRef, useState } from 'react';
import { Bot, Send, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MEGA_NICHES_CATEGORIES, findNiche, nicheValue } from '@/lib/niches-catalog';
import { speedConfig } from '@/lib/sms-speed';
import type { RemoteCommand } from '@/lib/remote-command';

type SimButton = { label: string; action: string };
type SimMessage = { id: number; from: 'bot' | 'user'; text: string; buttons?: SimButton[] | undefined };

const REGIONS = ['Mazowieckie', 'Małopolskie', 'Śląskie', 'Wielkopolskie', 'Dolnośląskie', 'Pomorskie', 'Świętokrzyskie', 'Łódzkie'];
const SOURCE_LABELS: Record<string, string> = { GOOGLE_MAPS: '🗺️ Google Maps', CEIDG: '🏢 CEIDG', OLX: '🟣 OLX' };
const SOURCE_ALIASES: Record<string, string> = { olx: 'OLX', maps: 'GOOGLE_MAPS', mapy: 'GOOGLE_MAPS', google: 'GOOGLE_MAPS', ceidg: 'CEIDG' };

let nextId = 1;
const msg = (from: 'bot' | 'user', text: string, buttons?: SimButton[]): SimMessage => ({ id: nextId++, from, text, buttons });

/**
 * Interaktywny symulator czatu Telegram — czysty mock w przeglądarce.
 * Nigdy nie wywołuje mostu Electron ani nie wysyła prawdziwych wiadomości.
 * Przyciski pilota dodatkowo sterują ekranem aplikacji przez onCommand
 * (ten sam kształt polecenia, który na Macu wysyła Electron).
 */
export function TelegramSimulator({ onLog, onCommand }: { onLog?: (text: string) => void; onCommand?: ((cmd: RemoteCommand) => void) | undefined }) {
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [draft, setDraft] = useState<{ source?: string; query?: string }>({});
  const [input, setInput] = useState('');
  const [paused, setPaused] = useState(false);
  const [scanning, setScanning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const push = (...m: SimMessage[]) => setMessages(prev => [...prev, ...m]);
  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const log = (t: string) => onLog?.(t);

  const menuButtons: SimButton[] = [
    { label: '🔍 Zdalne Skanowanie', action: 'MENU_SCAN' },
    { label: '🚀 Masowa Wysyłka SMS (Bulk Send)', action: 'MENU_BULK' },
    { label: '📊 Status Kolejki & Statystyki', action: 'MENU_STATUS' },
    { label: '⏸️/▶️ Pauza / Wznów Wysyłkę', action: 'TOGGLE_BULK_PAUSE' },
  ];
  const sendMenu = () => push(msg('bot', '🤖 LeadFinder — Zdalne Centrum Dowodzenia\n📊 Status Maca mini\nLeady w bazie: 128\nKolejka SMS: kolejka pusta\nPoczekalnia: 0 oczekujących\n\nWybierz akcję:', menuButtons));

  const runScan = (source: string, query: string, region: string) => {
    setScanning(true);
    push(msg('bot', `⏳ Skanowanie uruchomione na ekranie Maca: ${SOURCE_LABELS[source]} — ${query} (${region}). Pełny skan — dam znać, gdy się zakończy.`));
    log(`Zlecono: /skan ${source.toLowerCase()} ${query} ${region}`);
    onCommand?.({ action: 'scan', source: source as 'GOOGLE_MAPS' | 'CEIDG' | 'OLX', query, region });
    later(1400, () => {
      const found = 24 + Math.floor(Math.random() * 20);
      const noSite = Math.round(found * 0.55), expired = Math.round(found * 0.2), noSsl = Math.round(found * 0.15);
      const olx = Math.max(0, found - noSite - expired - noSsl);
      setScanning(false);
      setPendingCount(found);
      push(msg('bot', `✅ Skanowanie zakończone! Znaleziono ${found} czystych numerów komórkowych (Brak strony: ${noSite}, Wygasła/Błąd: ${expired}, Brak SSL: ${noSsl}, OLX: ${olx}).`, [
        { label: `🚀 Dodaj wszystkie (${found}) i Wyślij Bulk SMS`, action: `REMOTE_ADD_AND_SEND:${found}` },
        { label: `📥 Tylko zapisz wszystkie (${found}) do bazy`, action: `REMOTE_ADD_ONLY:${found}` },
        { label: '❌ Odrzuć wyniki', action: 'REMOTE_DISCARD' },
      ]));
      log(`Skan ${query} (${region}): znaleziono ${found} leadów`);
    });
  };

  const act = (action: string) => {
    if (scanning) return;
    if (action === 'MENU_SCAN') {
      push(msg('user', '🔍 Zdalne Skanowanie'), msg('bot', '🔍 Wybierz źródło skanowania:', [
        { label: '🗺️ Google Maps', action: 'SCAN_SRC:GOOGLE_MAPS' },
        { label: '🏢 Nowe firmy CEIDG', action: 'SCAN_SRC:CEIDG' },
        { label: '🟣 Ogłoszenia OLX', action: 'SCAN_SRC:OLX' },
      ]));
    } else if (action.startsWith('SCAN_SRC:')) {
      const source = action.slice(9);
      const label = SOURCE_LABELS[source] ?? source;
      setDraft({ source });
      push(msg('user', label), msg('bot', `${label} — wybierz kategorię niszy:`, MEGA_NICHES_CATEGORIES.map(c => ({ label: `${c.icon} ${c.label}`, action: `SCAN_CAT:${c.id}` }))));
    } else if (action.startsWith('SCAN_CAT:')) {
      const cat = MEGA_NICHES_CATEGORIES.find(c => c.id === action.slice(9));
      if (!cat) return;
      push(msg('user', `${cat.icon} ${cat.label}`), msg('bot', `${cat.icon} ${cat.label} — wybierz niszę:`, cat.niches.map(n => ({ label: n.label, action: `SCAN_NICHE:${n.id}` }))));
    } else if (action.startsWith('SCAN_NICHE:')) {
      const niche = findNiche(action.slice(11));
      const source = draft.source;
      if (!niche || !source) return;
      const query = nicheValue(niche, source as 'GOOGLE_MAPS' | 'CEIDG' | 'OLX');
      setDraft(d => ({ ...d, query }));
      push(msg('user', niche.label), msg('bot', `Nisza: ${niche.label}\nWybierz województwo:`, REGIONS.map(r => ({ label: r, action: `SCAN_REGION:${r}` }))));
    } else if (action.startsWith('SCAN_REGION:')) {
      const region = action.slice(12);
      push(msg('user', region));
      if (draft.source && draft.query) runScan(draft.source, draft.query, region);
      setDraft({});
    } else if (action === 'MENU_BULK') {
      if (pendingCount) { act(`REMOTE_ADD_AND_SEND:${pendingCount}`); return; }
      push(msg('user', '🚀 Masowa Wysyłka SMS'), msg('bot', '🚀 Masowa wysyłka\n📊 Leady w bazie: 128\nKolejka SMS: kolejka pusta\n\nNajpierw zeskanuj leady (🔍 Zdalne Skanowanie lub /skan).'));
    } else if (action === 'MENU_STATUS') {
      push(msg('user', '📊 Status'), msg('bot', `📊 Status Maca mini\nLeady w bazie: 128\nKolejka SMS: ${paused ? 'pauza' : 'kolejka pusta'}\nPoczekalnia: 0 oczekujących`));
      log('Z telefonu: /status');
    } else if (action === 'TOGGLE_BULK_PAUSE') {
      setPaused(p => !p);
      push(msg('user', paused ? '▶️ Wznów' : '⏸️ Pauza'), msg('bot', paused ? '▶️ Wysyłka wznowiona.' : '⏸️ Wysyłka wstrzymana.'));
      log(paused ? 'Z telefonu: wznowiono wysyłkę' : 'Z telefonu: wstrzymano wysyłkę');
    } else if (action.startsWith('REMOTE_ADD_AND_SEND:')) {
      const n = Number(action.split(':')[1]) || 0;
      if (!pendingCount) return;
      push(msg('user', '🚀 Dodaj i Wyślij Bulk SMS'), msg('bot', 'Wybierz tempo (szacunek dla 100 SMS):', [
        { label: '🚀 Wyślij TURBO (~4 min)', action: `SPEED:turbo:${n}` },
        { label: '⚡ Wyślij SZYBKO (~12 min)', action: `SPEED:fast:${n}` },
      ]));
    } else if (action.startsWith('SPEED:')) {
      const [, mode, raw] = action.split(':');
      const n = Number(raw);
      if (!pendingCount || n !== pendingCount || (mode !== 'turbo' && mode !== 'fast')) return;
      setPendingCount(0);
      const speed = speedConfig(mode);
      push(msg('user', mode === 'turbo' ? '🚀 TURBO' : '⚡ SZYBKI'), msg('bot', `Symulacja: wybrano tempo ${speed.minDelayMs / 1000}–${speed.maxDelayMs / 1000} s dla ${n} leadów. Nie wysłano prawdziwych SMS.`));
      log(`Wybrano ${mode}: ${n} wiadomości (symulacja)`);
      onCommand?.({ action: 'addAndSend', speed });
    } else if (action.startsWith('REMOTE_ADD_ONLY:')) {
      const n = Number(action.split(':')[1]) || 0;
      push(msg('user', '📥 Tylko zapisz do bazy'), msg('bot', `📥 Przekazano do ekranu Maca — zapisuję ${n} leadów do bazy. Wysyłkę uruchomisz komendą /wyslij.`));
      log(`Zapisano ${n} leadów do bazy (symulacja)`);
      onCommand?.({ action: 'addOnly' });
    } else if (action === 'REMOTE_DISCARD') {
      setPendingCount(0);
      push(msg('user', '❌ Odrzuć wyniki'), msg('bot', '❌ Odrzucono wyniki skanowania.'));
      log('Odrzucono wyniki skanu (symulacja)');
      onCommand?.({ action: 'discard' });
    }
  };

  const sendCommand = () => {
    const t = input.trim();
    if (!t || scanning) return;
    setInput('');
    push(msg('user', t));
    const parts = t.split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    if (cmd === '/start' || cmd === '/menu') { log('Z telefonu: /menu'); sendMenu(); }
    else if (cmd === '/status') act('MENU_STATUS');
    else if (cmd === '/pauza') act('TOGGLE_BULK_PAUSE');
    else if (cmd === '/wyslij') act('MENU_BULK');
    else if (cmd === '/skan') {
      const source = SOURCE_ALIASES[(parts[1] || '').toLowerCase()];
      const regionRaw = parts[parts.length - 1] || '';
      const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
      const region = REGIONS.find(r => strip(r) === strip(regionRaw));
      const query = parts.slice(2, -1).join(' ');
      if (source && region && query) runScan(source, query, region);
      else push(msg('bot', 'Użycie: /skan <olx|maps|ceidg> <nisza> <województwo>\nNp. /skan olx fotograf slubny malopolskie'));
    } else push(msg('bot', 'Nieznana komenda. Dostępne: /menu, /skan, /wyslij, /status, /pauza'));
  };

  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
      <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary"><Bot className="size-5" /></span>
        <div className="min-w-0"><p className="truncate text-sm font-semibold">LeadFinder Bot</p><p className="text-xs text-chart-2">bot • symulacja</p></div>
        <Smartphone className="ml-auto size-4 text-muted-foreground" />
      </div>
      <div className="flex h-96 flex-col gap-2 overflow-y-auto bg-background/60 p-3">
        {!messages.length && (
          <div className="m-auto space-y-3 text-center">
            <p className="text-sm text-muted-foreground">To symulator czatu z botem — kliknij, aby przetestować zdalne sterowanie bez Maca.</p>
            <Button size="sm" onClick={sendMenu}>▶️ Rozpocznij (/menu)</Button>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={m.from === 'user' ? 'self-end' : 'self-start'} style={{ maxWidth: '85%' }}>
            <div className={`whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${m.from === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted text-foreground'}`}>{m.text}</div>
            {m.buttons && (
              <div className="mt-1 flex flex-col gap-1">
                {m.buttons.map(b => (
                  <Button variant="outline" key={b.action + b.label} type="button" disabled={scanning} onClick={() => act(b.action)}
                    className="rounded-lg border border-primary/40 bg-primary/5 px-2 py-1.5 text-center text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50">
                    {b.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {scanning && <p className="self-start text-xs text-muted-foreground">Mac mini skanuje…</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-muted/50 p-2">
        <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendCommand()} placeholder="/skan olx fotograf slubny malopolskie" className="h-9 text-sm" aria-label="Komenda Telegram" />
        <Button size="icon" className="size-9 shrink-0" onClick={sendCommand} aria-label="Wyślij komendę"><Send className="size-4" /></Button>
      </div>
    </div>
  );
}
