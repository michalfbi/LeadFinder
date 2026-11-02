/**
 * Zdalne sterowanie ekranem Maca z telefonu (Telegram) lub z symulatora pilota.
 * Electron wysyła "remote:command" do okna Reacta; w podglądzie przeglądarkowym
 * symulator pilota wywołuje ten sam kształt polecenia przez callback.
 */
import type { SpeedConfig } from './sms-speed';
export type RemoteCommand =
  | { action: 'scan'; source: 'GOOGLE_MAPS' | 'CEIDG' | 'OLX'; query: string; region: string }
  | { action: 'addAndSend'; speed?: SpeedConfig }
  | { action: 'addOnly' }
  | { action: 'discard' };

export type RemoteCommandEnvelope = { cmd: RemoteCommand; at: number };

export function describeRemoteCommand(cmd: RemoteCommand): string {
  switch (cmd.action) {
    case 'scan': {
      const label = cmd.source === 'GOOGLE_MAPS' ? 'Mapy Google' : cmd.source === 'CEIDG' ? 'CEIDG' : 'OLX';
      return `Skanowanie: ${label} • ${cmd.query} • ${cmd.region}`;
    }
    case 'addAndSend': return 'Dodaję wszystkie wyniki i uruchamiam wysyłkę SMS';
    case 'addOnly': return 'Zapisuję wszystkie wyniki do bazy';
    case 'discard': return 'Odrzucam wyniki skanowania';
  }
}

type RemoteListener = (cmd: RemoteCommand) => void;

/** Subskrypcja zdarzeń z procesu głównego Electrona (undefined w przeglądarce). */
export function onRemoteCommand(cb: RemoteListener): (() => void) | undefined {
  if (typeof window === 'undefined') return undefined;
  const lf = (window as unknown as { leadfinder?: { onRemoteCommand?: (cb: RemoteListener) => () => void } }).leadfinder;
  return lf?.onRemoteCommand?.(cb);
}

/** Raport zwrotny do telefonu po zakończeniu akcji na ekranie Maca. */
export function reportRemoteResult(text: string, withButtons = false): void {
  if (typeof window === 'undefined') return;
  const lf = (window as unknown as { leadfinder?: { autopilot?: { remoteReport?: (p: { text: string; withButtons: boolean }) => Promise<unknown> } } }).leadfinder;
  void lf?.autopilot?.remoteReport?.({ text, withButtons })?.catch(() => {});
}
