import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtensionMessage, ExtensionResponse, TimerState, TimerStartPayload, TimerAttachPayload, TicketRef } from '@pomodoso/types';
import { IDLE_TIMER_STATE } from '@pomodoso/types';

const DEV_DETECTED_TICKET: TicketRef = {
  provider_kind: 'linear',
  external_id: 'INT-518',
  external_url: 'https://linear.app/example/issue/INT-518',
  title: 'Finish InsuranceLineConfig migration to new schema',
  status: 'in_progress',
};

const DEV_SELECTED_TEXT = 'The new rate limiter should handle 10k RPS with sub-10ms p99 latency. Need to verify this with load tests before merging.';

async function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    if (message.type === 'timer.getState') return { ...IDLE_TIMER_STATE } as T;
    if (message.type === 'ticket.getDetected') return DEV_DETECTED_TICKET as T;
    return null as T;
  }
  const response: ExtensionResponse<T> = await chrome.runtime.sendMessage(message);
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export function useTimerState() {
  const [timerState, setTimerState] = useState<TimerState>({ ...IDLE_TIMER_STATE });
  const [detectedTicket, setDetectedTicket] = useState<TicketRef | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const [state, ticket] = await Promise.all([
      sendMessage<TimerState>({ type: 'timer.getState' }),
      sendMessage<TicketRef | null>({ type: 'ticket.getDetected' }),
    ]);
    setTimerState(state);

    if (ticket && typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabUrl = tab?.url ?? '';
        const ticketBase = ticket.external_url.split('?')[0] ?? '';
        const ticketHost = new URL(ticketBase).hostname;
        const tabHost = tabUrl ? new URL(tabUrl).hostname : '';
        const urlMatch = ticketHost === tabHost && tabUrl.includes(ticketBase.split('/').slice(-1)[0] ?? '');
        setDetectedTicket(urlMatch ? ticket : null);
      } catch {
        setDetectedTicket(null);
      }
    } else {
      setDetectedTicket(ticket);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    tickRef.current = setInterval(() => void refresh(), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    const querySelection = async () => {
      if (typeof chrome === 'undefined' || !chrome.tabs) {
        setSelectedText(DEV_SELECTED_TEXT);
        return;
      }
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.getSelection()?.toString().trim() ?? '',
          });
          const text = results[0]?.result as string | undefined;
          if (text && text.length > 3) {
            setSelectedText(text);
            return;
          }
        }
      } catch {
        // scripting restricted on chrome:// and some other pages — fall through
      }
      try {
        const result = await chrome.storage.session.get('capturedSelection');
        const stored = result['capturedSelection'] as string | undefined;
        if (stored && stored.length > 3) setSelectedText(stored);
      } catch {
        // storage.session unavailable in some contexts
      }
    };
    void querySelection();
  }, []);

  const start = useCallback(async (payload: TimerStartPayload) => {
    const state = await sendMessage<TimerState>({ type: 'timer.start', payload });
    setTimerState(state);
  }, []);

  const attachTask = useCallback(async (payload: TimerAttachPayload) => {
    const state = await sendMessage<TimerState>({ type: 'timer.attachTask', payload });
    setTimerState(state);
  }, []);

  const detachTask = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.detachTask' });
    setTimerState(state);
  }, []);

  const pausePomo = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.pause' });
    setTimerState(state);
  }, []);

  const resumePomo = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.resume' });
    setTimerState(state);
  }, []);

  const completePomo = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.complete' });
    setTimerState(state);
  }, []);

  const startBreak = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.startBreak' });
    setTimerState(state);
  }, []);

  const snooze = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.snooze' });
    setTimerState(state);
  }, []);

  const stop = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.stop' });
    setTimerState(state);
  }, []);

  const clearPendingSegment = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.clearPendingSegment' });
    setTimerState(state);
  }, []);

  const extendBreak = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.extendBreak' });
    setTimerState(state);
  }, []);

  const startNextPomo = useCallback(async () => {
    const state = await sendMessage<TimerState>({ type: 'timer.startNextPomo' });
    setTimerState(state);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedText(null);
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      void chrome.storage.session.remove('capturedSelection');
    }
  }, []);

  return { timerState, detectedTicket, selectedText, clearSelection, loading, start, attachTask, detachTask, pausePomo, resumePomo, completePomo, startBreak, snooze, stop, clearPendingSegment, extendBreak, startNextPomo };
}
