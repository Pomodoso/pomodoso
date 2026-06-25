interface PopupFooterProps {
  pomosToday: number;
  minutesToday: number;
}

export function PopupFooter({ pomosToday, minutesToday }: PopupFooterProps) {
  const hours = Math.floor(minutesToday / 60);
  const mins = minutesToday % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div style={{
      padding: '8px 14px',
      borderTop: '1px solid var(--color-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 'auto',
    }}>
      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--color-text-muted)' }}>
        <span>🍅 {pomosToday} pomos</span>
        <span>·</span>
        <span>⏱ {timeStr} today</span>
      </div>
      <button
        style={{
          fontSize: 11,
          color: 'var(--color-info)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
        onClick={() => chrome.tabs.create({ url: 'https://pomodoso.com/dashboard' })}
      >
        Open app ↗
      </button>
    </div>
  );
}
