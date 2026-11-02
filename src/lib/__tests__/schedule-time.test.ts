import { describe, expect, it } from 'vitest';
import { initialState } from '../autopilot';
import { isScheduleTime, retainTimeDrafts } from '../schedule-time';

describe('Weekly schedule time editing', () => {
  it('retains a blurred time across an old snapshot without changing other days', () => {
    const snapshot = initialState();
    const result = retainTimeDrafts(snapshot, { monday: '14:35' });
    expect(result.weeklySchedule[0]?.scanTime).toBe('14:35');
    expect(result.weeklySchedule[1]?.scanTime).toBe('07:00');
    expect(snapshot.weeklySchedule[0]?.scanTime).toBe('07:00');
  });
  it('accepts complete clock times and rejects unfinished or invalid edits', () => {
    expect(isScheduleTime('14:35')).toBe(true);
    expect(isScheduleTime('23:59')).toBe(true);
    expect(isScheduleTime('14:')).toBe(false);
    expect(isScheduleTime('24:00')).toBe(false);
    expect(isScheduleTime('07:60')).toBe(false);
  });
  it('follows externally changed times when no local draft exists', () => {
    const snapshot = initialState();
    snapshot.weeklySchedule[0] = { ...snapshot.weeklySchedule[0], day: 'monday', enabled: false, source: 'OLX', queryOrPkd: '', voivodeship: 'Mazowieckie', dailyTargetLimit: 50, scanTime: '10:45' };
    expect(retainTimeDrafts(snapshot, {}).weeklySchedule[0]?.scanTime).toBe('10:45');
  });
});