import { useEffect, useState } from 'react';
import { Search, Crosshair, Database, MessageSquare, Bot, ChartNoAxesCombined, Settings2, Radar, Smartphone, PanelsTopLeft, ArrowUpRight, CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getBridge, type BulkQueueStatus } from '@/lib/bulk-send';
import { openDesktopWidget, widgetBridge } from '@/lib/widget-bridge';
import { toast } from 'sonner';

export const APP_DESTINATIONS = [
  { id: 'search', label: 'Wyszukiwarka', icon: Search },
  { id: 'sniper', label: '🎯 Snajper (Top 50)', icon: Crosshair },
  { id: 'base', label: 'Moja Baza', icon: Database },
  { id: 'message', label: 'Szablony & Wysyłka', icon: MessageSquare },
  { id: 'autopilot', label: 'Autopilot', icon: Bot },
  { id: 'analytics', label: 'Analityka', icon: ChartNoAxesCombined },
  { id: 'settings', label: 'Ustawienia & Widget', icon: Settings2 },
];

export function AppSidebar({ active, onNavigate, hot }: {
  active: string; onNavigate: (tab: string) => void; hot: number;
}) {
  const [queue, setQueue] = useState<BulkQueueStatus | null>(null);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(Boolean(getBridge()?.isDesktop));
    let alive = true;
    const refresh = async () => {
      try {
        const value = await getBridge()?.bulkStatus?.();
        if (alive) setQueue(value ?? null);
      } catch { /* Keep the last known queue state. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const run = (action: () => Promise<unknown>) => void action().catch(() => toast.error('Nie udało się otworzyć okna.'));
  return <aside className="app-sidebar apple-glass-panel">
    <div>
      <div className="traffic-lights" aria-hidden="true"><span /><span /><span /></div>
      <div className="mb-7 mt-7 flex items-center gap-3 px-2">
        <div className="brand-mark"><Radar className="size-6" /></div>
        <div><h1 className="text-lg font-semibold">LeadFinder <span className="text-muted-foreground">Pro</span></h1><p className="mt-0.5 text-xs text-muted-foreground">Centrum pozyskiwania klientów</p></div>
      </div>
      <div className="apple-segment mb-7 flex" role="group" aria-label="Kanał kontaktu">
        <Button variant="ghost" size="sm" aria-pressed className="apple-segment-active min-w-0 flex-1">
          <Smartphone /> Kanał SMS
        </Button>
      </div>
      <p className="mb-3 px-3 text-[11px] font-medium text-muted-foreground">PRZESTRZEŃ ROBOCZA</p>
      <nav aria-label="Nawigacja główna" className="space-y-1">
        {APP_DESTINATIONS.map(({ id, label, icon: Icon }) => <Button key={id} variant="ghost" aria-label={label} onClick={() => onNavigate(id)} aria-current={active === id ? 'page' : undefined} className={`sidebar-item ${active === id ? 'sidebar-item-active' : ''} ${id === 'sniper' ? 'border border-amber-400/30 bg-amber-400/10 text-amber-200 backdrop-blur-xl' : ''}`}>
          <Icon className="size-[18px]" /><span className="flex-1 text-left">{label}</span>
          {id === 'base' && hot > 0 && <span className="rounded-full bg-destructive/20 px-2 py-0.5 text-xs tabular-nums text-destructive">{hot}</span>}
        </Button>)}
      </nav>
    </div>
    <div className="sidebar-status mt-8 border-t border-border pt-5">
      <p className="flex items-center gap-2 text-xs font-medium"><span className={`size-1.5 rounded-full ${desktop ? 'bg-chart-2 motion-safe:animate-pulse' : 'bg-muted-foreground'}`} />{desktop ? 'Silnik aktywny' : 'Podgląd przeglądarkowy'}</p>
      <p className="mt-2 text-xs tabular-nums text-muted-foreground">{queue?.running ? `${queue.paused ? 'Wstrzymano' : 'Kolejka'} · ${queue.queued} oczekujących` : 'Kolejka wolna'}</p>
      <Button variant="outline" size="sm" className="mt-4 w-full justify-start" onClick={() => run(openDesktopWidget)}><PanelsTopLeft />Otwórz Widget<ArrowUpRight className="ml-auto" /></Button>
      {desktop && <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => run(async () => widgetBridge()?.openMain?.())}><ArrowUpRight />Przenieś na 2. ekran</Button>}
      <p className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground"><CircleHelp className="size-3" />LeadFinder B2B · lokalny warsztat</p>
    </div>
  </aside>;
}
