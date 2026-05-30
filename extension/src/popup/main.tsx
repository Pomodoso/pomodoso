import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/globals.css';
import { App } from './App';

const el = document.getElementById('app');
if (!el) throw new Error('Missing #app');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
