import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { isEmbedded } from './core/uiEnv';
// Framed by the Liquidity Radar host (its Pro tab): the host owns the bottom nav on mobile.
if (isEmbedded()) document.documentElement.classList.add('embedded');
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {}));
