import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/globals.css';
import { AppPage } from './AppPage';

// An app in its own browser tab: the room a kanban needs, which the 360px
// popup doesn't have. app/index.html?plugin=<id>[&view=<id>][&record=<id>]

const el = document.getElementById('app');
if (!el) throw new Error('Missing #app');

createRoot(el).render(
  <React.StrictMode>
    <AppPage />
  </React.StrictMode>,
);
