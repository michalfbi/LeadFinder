import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { speedConfig, estimateSmsTime } from '../sms-speed';
import { DEFAULT_SEND_SETTINGS } from '../send-settings';
const { normalizeSpeed, createSpeedClock } = createRequire(import.meta.url)('../../../electron/sms-speed.cjs');
describe('SMS tempo rules', () => {
  it('defaults to Fast 5–10 seconds in UI and desktop', () => {
    expect(normalizeSpeed()).toEqual({speedMode:'fast',minDelayMs:5000,maxDelayMs:10000});
    expect(DEFAULT_SEND_SETTINGS.speedMode).toBe('fast');
    expect(DEFAULT_SEND_SETTINGS.minDelayMs).toBe(5000);
    expect(DEFAULT_SEND_SETTINGS.maxDelayMs).toBe(10000);
  });
  it('Turbo is 1.5–3 seconds in both channels', () => {
    expect(speedConfig('turbo')).toEqual({speedMode:'turbo',minDelayMs:1500,maxDelayMs:3000});
    expect(normalizeSpeed({speedMode:'turbo'})).toEqual(speedConfig('turbo'));
  });
  it('Balance is 12–20 seconds', () => {
    expect(speedConfig('balance')).toEqual({speedMode:'balance',minDelayMs:12000,maxDelayMs:20000});
    expect(normalizeSpeed({speedMode:'balance'})).toEqual(speedConfig('balance'));
  });
  it('Custom has equal spacing bounded to 1–60 seconds', () => {
    expect(speedConfig('custom',0)).toEqual({speedMode:'custom',minDelayMs:1000,maxDelayMs:1000});
    expect(speedConfig('custom',61)).toEqual({speedMode:'custom',minDelayMs:60000,maxDelayMs:60000});
  });
  it('raw desktop delay parameters apply without a preset', () => {
    expect(normalizeSpeed({minDelayMs:2000,maxDelayMs:4000})).toMatchObject({minDelayMs:2000,maxDelayMs:4000});
  });
  it('live Turbo replaces the pending deadline without stacking waits', () => {
    let now = 0;const clock=createSpeedClock(()=>now,()=>0.5);clock.begin();
    expect(clock.remaining()).toBe(7500);now=1000;clock.set({speedMode:'turbo'});
    expect(clock.remaining()).toBe(1250);now=2250;expect(clock.remaining()).toBe(0);
  });
  it('live custom slowing and pause preserve the countdown', () => {
    let now=0;const clock=createSpeedClock(()=>now,()=>0.5);clock.begin();now=1000;
    clock.set({speedMode:'custom',minDelayMs:60000,maxDelayMs:60000});
    expect(clock.remaining()).toBe(59000);clock.postpone(1000);now=2000;
    expect(clock.remaining()).toBe(59000);clock.clear();expect(clock.nextAt).toBeNull();
  });
  it('ETA uses actual intervals for 100 SMS and zero for empty/single queues', () => {
    expect(estimateSmsTime(100,speedConfig('turbo')).totalSeconds).toBe(223);
    expect(estimateSmsTime(100,speedConfig('fast')).totalSeconds).toBe(743);
    expect(estimateSmsTime(100,speedConfig('balance')).totalSeconds).toBe(1584);
    expect(estimateSmsTime(0,speedConfig('fast')).totalSeconds).toBe(0);
    expect(estimateSmsTime(1,speedConfig('fast')).totalSeconds).toBe(0);
  });
});