const presets = require('../sms-speed-presets.json');
function normalizeSpeed(value = {}, fallback = { speedMode: 'fast', ...presets.fast }) {
  const speedMode = ['turbo', 'fast', 'balance', 'custom'].includes(value.speedMode) ? value.speedMode : fallback.speedMode;
  if (value.speedMode && presets[speedMode]) return { speedMode, ...presets[speedMode] };
  const clamp = (n, defaultValue) => Number.isFinite(Number(n)) ? Math.min(60000, Math.max(1000, Number(n))) : defaultValue;
  const minDelayMs = clamp(value.minDelayMs, fallback.minDelayMs);
  const maxDelayMs = Math.max(minDelayMs, clamp(value.maxDelayMs, fallback.maxDelayMs));
  return { speedMode, minDelayMs, maxDelayMs };
}
function createSpeedClock(now = Date.now, random = Math.random) {
  let config = normalizeSpeed(), startedAt = null, nextAt = null;
  const delay = () => config.minDelayMs + Math.floor(random() * (config.maxDelayMs - config.minDelayMs));
  return {
    get config() { return config; },
    get nextAt() { return nextAt; },
    set(value) { config = normalizeSpeed(value, config); if (startedAt !== null) nextAt = startedAt + delay(); return config; },
    begin() { startedAt = now(); nextAt = startedAt + delay(); },
    clear() { startedAt = null; nextAt = null; },
    remaining() { return nextAt === null ? 0 : Math.max(0, nextAt - now()); },
    postpone(ms) { if (nextAt !== null) { nextAt += ms; startedAt += ms; } },
  };
}
module.exports = { presets, normalizeSpeed, createSpeedClock };