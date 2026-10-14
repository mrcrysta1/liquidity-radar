import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register(new URL('sw.js', location.href)).catch(() => {}));
