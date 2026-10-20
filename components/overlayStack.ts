// ═════════════════════════════════════════════════════════════════════
// overlayStack — which open dialog owns the Esc key, and the page scroll lock.
//
// Overlay, Modal, useConfirm and usePrompt each used to add their own window
// Esc listener, so one Esc press closed a picker AND the quote editor under
// it — and the editor's unsaved quote went with it. Each open dialog now
// registers a layer here; one shared listener hands Esc to the topmost
// layer only.
//
// The page-scroll lock lives here too: each dialog used to save and restore
// body overflow itself, and when a confirm and the editor under it closed in
// the same render, they restored in the wrong order and left the page
// unscrollable. Now it's locked while any layer is open, restored when the
// last one closes.
// ═════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef } from 'react';

interface Layer { id: number; onEscape: () => void }

const layers: Layer[] = [];
let nextId = 1;
let listening = false;
let overflowBefore = '';

function onKeyDown(e: KeyboardEvent) {
  // Something inside the dialog (an inline edit field) already handled it.
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  // The top layer consumes Esc even when it ignores it (dismissable={false}),
  // so the press never falls through to the dialog underneath.
  e.preventDefault();
  top.onEscape();
}

/**
 * Register a dialog while `open`: locks page scroll, and Esc calls
 * `onEscape` only while this is the topmost open layer. Returns `isTop()`
 * for other shortcuts (Enter-to-confirm).
 */
export function useOverlayLayer(open: boolean, onEscape: () => void): () => boolean {
  // Latest callback without re-registering: re-registering on every render
  // (inline onClose arrows) would move this layer back to the top.
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  const idRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = nextId++;
    idRef.current = id;
    if (layers.length === 0) {
      overflowBefore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    layers.push({ id, onEscape: () => escRef.current() });
    if (!listening) { window.addEventListener('keydown', onKeyDown); listening = true; }
    return () => {
      const i = layers.findIndex(l => l.id === id);
      if (i >= 0) layers.splice(i, 1);
      if (layers.length === 0) document.body.style.overflow = overflowBefore;
      if (idRef.current === id) idRef.current = 0;
    };
  }, [open]);

  return useCallback(() => idRef.current !== 0 && layers[layers.length - 1]?.id === idRef.current, []);
}
