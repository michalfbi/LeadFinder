import presets from '../../sms-speed-presets.json';
export type SpeedMode = 'turbo' | 'fast' | 'balance' | 'custom';
export type SpeedConfig = { speedMode: SpeedMode; minDelayMs: number; maxDelayMs: number };
export const SPEED_PRESETS = presets;
export function speedConfig(mode: SpeedMode, seconds = 7.5): SpeedConfig {
  const ms = Math.round(Math.min(60, Math.max(1, seconds)) * 1000);
  return { speedMode: mode, ...(mode === 'custom' ? { minDelayMs: ms, maxDelayMs: ms } : presets[mode]) };
}
export function estimateSmsTime(count: number, config: SpeedConfig) {
  const averageSeconds = (config.minDelayMs + config.maxDelayMs) / 2000;
  const totalSeconds = Math.round(Math.max(0, count - 1) * averageSeconds);
  return { averageSeconds, totalSeconds, minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}