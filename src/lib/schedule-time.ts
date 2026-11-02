import type { Day, PilotState } from './autopilot';

export const isScheduleTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export function retainTimeDrafts(state: PilotState, drafts: Partial<Record<Day, string>>): PilotState {
  return {
    ...state,
    weeklySchedule: state.weeklySchedule.map(plan => ({
      ...plan,
      scanTime: drafts[plan.day] ?? plan.scanTime,
    })),
  };
}