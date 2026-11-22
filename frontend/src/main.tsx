import './authRedirect'; // must run first: it reads sign-in details out of the address bar before board.ts does
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import './sync'; // start live sync for this board
import './registry'; // list this board under "my boards"
import './account'; // optional account: sync that list across devices
import './pwa'; // installable + works offline

if (import.meta.env.DEV) void import('./stress'); // console helper: p2pwbStress(n)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
