/**
 * Print a finished HTML document from a hidden frame on this page — no
 * pop-up window.
 *
 * Travelers, packing slips, quotes and invoices used to open a new window
 * and print that. Phones block a window that isn't opened right at the tap,
 * and the traveler makes its QR code first, so "Print Traveler" did nothing
 * on a phone (and an installed home-screen app can't write into a new
 * window at all). A frame inside the page prints the same everywhere.
 */
export function printHtmlDocument(html: string): Promise<void> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') { resolve(); return; }
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Laid out at page width (off screen) so images load and the layout
    // settles before printing.
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:850px;height:1100px;border:0;opacity:0;pointer-events:none;';

    let fired = false;
    const remove = () => { try { frame.remove(); } catch { /* already gone */ } };
    const doPrint = () => {
      if (fired) return;
      fired = true;
      const w = frame.contentWindow;
      try {
        w?.addEventListener('afterprint', () => setTimeout(remove, 1000));
        w?.focus();
        w?.print();
      } catch { /* print blocked — nothing more we can do */ }
      // Phones return from print() before the print sheet closes; keep the
      // frame until it surely has.
      setTimeout(remove, 5 * 60_000);
      resolve();
    };

    frame.onload = () => {
      // Wait for the logo / part photo / QR images to finish loading, THEN
      // print — printing earlier can give a page with blank images.
      try {
        const imgs = Array.from(frame.contentDocument?.images || []);
        let pending = imgs.filter(im => !im.complete).length;
        if (pending === 0) setTimeout(doPrint, 250);
        else {
          const tick = () => { if (--pending <= 0) doPrint(); };
          imgs.forEach(im => { if (!im.complete) { im.addEventListener('load', tick); im.addEventListener('error', tick); } });
        }
      } catch { doPrint(); }
      setTimeout(doPrint, 3000);   // never hang on an image that stalls
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
