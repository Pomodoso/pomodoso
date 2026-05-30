// Persist the last meaningful selection so the popup can read it even when
// executeScript can't reliably read window.getSelection() (focus edge cases).

let lastSaved = '';

function trySet(value: string) {
  try { void chrome.storage.session.set({ capturedSelection: value }); } catch { /* context invalidated */ }
}
function tryClear() {
  try { void chrome.storage.session.remove('capturedSelection'); } catch { /* context invalidated */ }
}

document.addEventListener('selectionchange', () => {
  const text = window.getSelection()?.toString().trim() ?? '';
  if (text.length > 3) {
    lastSaved = text;
    trySet(text);
  }
  // Do NOT clear on empty: selectionchange fires on focus loss (e.g. opening the
  // extension toolbar popup), which would race-clear the value before the popup reads it.
});

// Clear only when the user deliberately clicks somewhere (deselects with intent).
// We check that the selection is actually empty after the click settles.
document.addEventListener('click', () => {
  requestAnimationFrame(() => {
    const text = window.getSelection()?.toString().trim() ?? '';
    if (text.length <= 3 && lastSaved) {
      lastSaved = '';
      tryClear();
    }
  });
});
