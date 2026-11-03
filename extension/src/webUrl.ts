/** The web app the extension links to: pomodoso.com, or a local one in a dev
 *  build (VITE_WEB_URL, set by `make extension`). */
export const WEB_URL = (import.meta.env.VITE_WEB_URL as string | undefined) ?? 'https://pomodoso.com';
