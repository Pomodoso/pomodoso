import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/globals.css';
import { ReportPage } from './ReportPage';

// Spec 6.6 calls for reports in "popup + simple new tab". This is the tab
// half: the popup is 320px wide and already carries four tabs, which is no
// place for a week grouped by project alongside an export pane.

const el = document.getElementById('app');
if (!el) throw new Error('Missing #app');

createRoot(el).render(
  <React.StrictMode>
    <ReportPage />
  </React.StrictMode>,
);
