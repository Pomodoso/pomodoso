import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

function todayStr(): string {
  // Local calendar date, not UTC — a UTC-based key rolls the day over at the
  // wrong local time.
  return new Date().toLocaleDateString('en-CA');
}

// A screen can stay mounted and idle across local midnight with no other
// trigger to re-render. Two complementary refreshes: AppState covers the
// realistic case (phone locked overnight, app resumed later); a timer
// scheduled for the exact next local midnight covers the app staying active
// and foregrounded the whole time, which AppState alone wouldn't catch.
export function useTodayDate(): string {
  const [today, setToday] = useState(todayStr);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setToday(todayStr());
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function scheduleMidnightRefresh(): void {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(() => {
        setToday(todayStr());
        scheduleMidnightRefresh();
      }, nextMidnight.getTime() - now.getTime());
    }
    scheduleMidnightRefresh();
    return () => clearTimeout(timer);
  }, []);

  return today;
}
