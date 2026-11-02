import { useEffect, useRef, useState } from 'react';
import { Zap, Rocket, Shield, SlidersHorizontal, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useSendSettings } from '@/lib/send-settings';
import { getBridge, useIsDesktopApp } from '@/lib/bulk-send';
import { estimateSmsTime, speedConfig, type SpeedMode } from '@/lib/sms-speed';

const modes = [
  { id: 'turbo', label: 'TURBO', range: '1,5–3 s', Icon: Rocket },
  { id: 'fast', label: 'SZYBKI', range: '5–10 s', Icon: Zap },
  { id: 'balance', label: 'BALANS', range: '12–20 s', Icon: Shield },
  { id: 'custom', label: 'WŁASNY', range: '1–60 s', Icon: SlidersHorizontal },
] as const;

export function SmsSpeedPanel({ count = 100, running = false }: { count?: number; running?: boolean }) {
  const { settings, save } = useSendSettings();
  const isDesktop = useIsDesktopApp();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [sent, setSent] = useState(0);
  const [nextIn, setNextIn] = useState(0);
  const deadline = useRef<number | null>(null);
  const lastSent = useRef(0);
  const eta = estimateSmsTime(Math.max(0, count - (preview ? sent : 0)), settings);
  const apply = async (mode: SpeedMode, seconds = settings.delaySeconds) => {
    const config = speedConfig(mode, seconds);
    try {
      await getBridge()?.setSpeedConfig?.(config);
      save({ ...config, delaySeconds: (config.minDelayMs + config.maxDelayMs) / 2000 });
      setError(null);
    } catch { setError('Nie udało się zmienić tempa na Macu. Spróbuj ponownie.'); }
  };
  useEffect(() => {
    if (preview) deadline.current = lastSent.current + (settings.minDelayMs + settings.maxDelayMs) / 2;
  }, [settings.minDelayMs, settings.maxDelayMs, preview]);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setInterval(() => {
      if (deadline.current === null) return;
      if (Date.now() >= deadline.current) {
        lastSent.current = Date.now();
        deadline.current = lastSent.current + (settings.minDelayMs + settings.maxDelayMs) / 2;
        setSent(n => n + 1);
      }
      setNextIn(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    }, 100);
    return () => window.clearInterval(timer);
  }, [preview, settings.minDelayMs, settings.maxDelayMs]);
  useEffect(() => { if (sent >= count) setPreview(false); }, [sent, count]);
  return (
    <section className="apple-glass-panel self-start space-y-4 rounded-xl p-4" aria-label="Prędkość Wysyłki SMS">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Zap className="size-4 text-primary" /> Prędkość Wysyłki SMS <span className="font-normal text-muted-foreground">(Tempo Kolejki)</span></h3>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/40 p-1 sm:grid-cols-4" role="group" aria-label="Tryb prędkości">
        {modes.map(({ id, label, range, Icon }) => (
          <Button key={id} variant={settings.speedMode === id ? 'secondary' : 'ghost'} aria-pressed={settings.speedMode === id} className="h-16 min-w-0 flex-col gap-1 px-2" onClick={() => void apply(id)}>
            <span className="flex items-center gap-1 text-xs"><Icon className="size-3.5" />{label}</span><span className="text-xs font-normal text-muted-foreground">{range}</span>
          </Button>
        ))}
      </div>
      {settings.speedMode === 'custom' && <div className="space-y-3">
        <div className="flex justify-between text-sm"><span>Przerwa między SMS</span><span className="tabular-nums">{settings.delaySeconds} s</span></div>
        <Slider aria-label="Przerwa między SMS w sekundach" min={1} max={60} step={1} value={[settings.delaySeconds]} onValueChange={v => void apply('custom', v[0] ?? 1)} />
      </div>}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Timer className="mt-0.5 size-4 shrink-0" /><span>Szacowany czas dla {Math.max(0, count - (preview ? sent : 0))} leadów: ok. <strong className="font-medium text-foreground tabular-nums">{eta.minutes} min {eta.seconds} sek</strong> · średnio 1 SMS co {eta.averageSeconds.toLocaleString('pl-PL')} s. Bez czasu obsługi Wiadomości i blokady godzinowej.</span></p>
      {(running || preview) && <Button variant="outline" size="sm" onClick={() => void apply('turbo')}><Rocket className="mr-2 size-4" /> Przyspiesz (Turbo)</Button>}
      {!isDesktop && <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => { lastSent.current = Date.now(); setSent(0); setPreview(p => !p); }}>{preview ? 'Zatrzymaj symulację' : 'Symuluj tempo SMS'}</Button>
        {preview && <output className="text-xs tabular-nums text-muted-foreground">Symulacja: {sent}/{count} · kolejny SMS za {nextIn} s</output>}
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}