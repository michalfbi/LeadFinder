import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { isScheduleTime } from '@/lib/schedule-time';
import type { Day } from '@/lib/autopilot';

export function ScheduleTimeInput({ day, value, onCommit }: {
  day: Day;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [timeVal, setTimeVal] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setTimeVal(value);
  }, [day, value]);

  return <Input id={`time-${day}`} type="time" value={timeVal}
    onFocus={() => { editing.current = true; }}
    onChange={event => setTimeVal(event.target.value)}
    onBlur={() => {
      editing.current = false;
      if (!isScheduleTime(timeVal)) { setTimeVal(value); return; }
      if (timeVal !== value) onCommit(timeVal);
    }} />;
}