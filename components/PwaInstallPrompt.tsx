// ═════════════════════════════════════════════════════════════════════
// PWA Install Prompt — encourages workers to add the app to their home screen.
//
// Why bother: installed PWAs on iOS get real push notifications (iOS 16.4+).
// Browser tabs do NOT. Workers installed to home screen = reminders work
// when the phone is locked and in their pocket.
//
// Platforms:
//   • Android / Desktop Chrome: we get a `beforeinstallprompt` event.
//     Show a native install button that calls the deferred prompt.
//   • iOS Safari: no prompt event. Show instructions: "Share → Add to Home Screen".
//   • If already installed (display-mode: standalone), hide entirely.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import { X, Download, Bell } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'pwa_install_dismissed_at';
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // don't nag for 7 days after dismiss

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}
function isStandalone(): boolean {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as any).standalone === true
  );
}

export const PwaInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if recently dismissed
    try {
      const last = localStorage.getItem(DISMISS_KEY);
      if (last && Date.now() - Number(last) < DISMISS_WINDOW_MS) {
        setDismissed(true);
        return;
      }
    } catch {}

    // Already installed? Nothing to do.
    if (isStandalone()) {
      setDismissed(true);
      return;
    }

    // Android/Desktop: capture the install prompt
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS: no native prompt — show our own hint after a delay
    if (isIOS() && !isStandalone()) {
      const t = setTimeout(() => setShowIosHint(true), 4000);
      return () => { clearTimeout(t); window.removeEventListener('beforeinstallprompt', onBeforeInstall); };
    }
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosHint(false);
  };

  if (dismissed) return null;
  if (!deferredPrompt && !showIosHint) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[9998] animate-fade-in">
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 border border-blue-400/30 rounded-2xl shadow-2xl shadow-blue-900/50 p-4 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-white">Install SC Tracker on your phone</p>
            <p className="text-xs text-white/80 mt-1 leading-relaxed">
              {deferredPrompt
                ? 'Get timer reminders and clock-in alerts — even when the app is closed.'
                : 'Tap the Share button (↑) in Safari, then "Add to Home Screen" for real background reminders.'}
            </p>
            <div className="flex items-center gap-2 mt-3">
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={handleInstall}
                  className="bg-white text-blue-700 hover:bg-white/90 px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" /> Install
                </button>
              )}
              <button
                type="button"
                onClick={handleDismiss}
                className="text-white/80 hover:text-white text-xs font-bold px-2 py-1.5"
              >
                {deferredPrompt ? 'Maybe later' : 'Got it'}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close install prompt"
            className="text-white/70 hover:text-white p-1 -mr-1 -mt-1 shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
