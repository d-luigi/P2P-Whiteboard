import { create } from 'zustand';
import { toast } from './toast';

/**
 * INSTALLABLE + OFFLINE (PWA).
 *
 *  - public/sw.js keeps the app's own files so the app opens with no network. Drawings are
 *    already kept in IndexedDB and merge with other people when you reconnect (sync.ts).
 *  - This file registers the service worker (production only), asks the browser not to evict
 *    saved boards, and offers an "Install app" action:
 *      Chrome / Edge / Android   the browser's own install prompt (beforeinstallprompt)
 *      iPhone / iPad (Safari)    no prompt exists: we explain Share > Add to Home Screen
 *      Already installed         nothing is offered
 */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const usePwa = create<{ canInstall: boolean; installed: boolean }>(() => ({
  canInstall: !isStandalone() && isIOS(), // on iOS we can only explain how
  installed: isStandalone(),
}));

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we show our own button instead of the browser's mini-bar
  deferred = e as InstallEvent;
  usePwa.setState({ canInstall: true });
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  usePwa.setState({ canInstall: false, installed: true });
  toast('Installed. You can open the whiteboard from your apps, even offline.');
});

export async function installApp() {
  if (deferred) {
    const ev = deferred;
    deferred = null;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'dismissed') usePwa.setState({ canInstall: true }); // they can try again later
    else usePwa.setState({ canInstall: false });
    return;
  }
  if (isIOS()) {
    toast('To install: tap the Share button in Safari, then "Add to Home Screen".', 'info', 9000);
  } else {
    toast("Your browser didn't offer installing. Try the install icon in the address bar, or the browser menu.", 'info', 9000);
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Offline mode unavailable', err));
  });
}

// Boards live in IndexedDB. Ask the browser to keep them rather than evict them when space is low.
void navigator.storage?.persist?.().catch(() => undefined);
