/* ======================================================================
   FabTrack IO — Marketing Site JS (light editorial v4)
   Vanilla JS, no framework. Tiny.
   ====================================================================== */

(function () {
  'use strict';

  // ── Floating pill nav drawer (mobile) ───────────────────────────
  function initPillNav() {
    const toggle = document.querySelector('[data-pill-toggle]');
    const drawer = document.querySelector('[data-pill-drawer]');
    if (!toggle || !drawer) return;

    function setOpen(open) {
      drawer.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    }
    toggle.addEventListener('click', function () {
      setOpen(!drawer.classList.contains('open'));
    });
    drawer.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
    // Close drawer on resize up
    let lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      const w = window.innerWidth;
      if (w !== lastW && w >= 760) setOpen(false);
      lastW = w;
    });
  }

  // ── Stagger reveal on scroll ────────────────────────────────────
  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  // ── Year + live clock ───────────────────────────────────────────
  function injectYear() {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }
  function initClock() {
    const el = document.querySelector('[data-clock]');
    if (!el) return;
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function tick() {
      const d = new Date();
      el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    tick();
    setInterval(tick, 30 * 1000);
  }

  // ── Contact form (demo only, no backend) ────────────────────────
  function initContactForm() {
    const form = document.querySelector('[data-contact-form]');
    if (!form) return;
    const successEl = form.querySelector('[data-success]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      setTimeout(function () {
        form.reset();
        if (successEl) successEl.style.display = 'block';
        if (btn) { btn.disabled = false; btn.textContent = 'Send →'; }
      }, 700);
    });
  }

  // ── Cursor spotlight on bento tiles ─────────────────────────────
  function initSpotlight() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    document.querySelectorAll('.tile').forEach(function (tile) {
      tile.addEventListener('pointermove', function (e) {
        var r = tile.getBoundingClientRect();
        tile.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        tile.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  // ── Magnetic buttons (pull toward cursor within radius) ─────────
  function initMagneticButtons() {
    if (window.matchMedia && (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )) return;

    var radius = 80; // pixels of magnetic pull range
    var strength = 0.25; // how strongly the button moves (0-1)

    document.querySelectorAll('.btn-primary, .pill-cta, .btn-tier-primary, .pill-brand').forEach(function (btn) {
      btn.classList.add('btn-magnetic');
      var rect = null;

      function updateRect() { rect = btn.getBoundingClientRect(); }
      btn.addEventListener('pointerenter', updateRect);

      btn.addEventListener('pointermove', function (e) {
        if (!rect) updateRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < radius) {
          btn.style.setProperty('--mx-pull', (dx * strength) + 'px');
          btn.style.setProperty('--my-pull', (dy * strength) + 'px');
        }
      });

      btn.addEventListener('pointerleave', function () {
        btn.style.setProperty('--mx-pull', '0px');
        btn.style.setProperty('--my-pull', '0px');
        rect = null;
      });

      window.addEventListener('scroll', function () { rect = null; }, { passive: true });
      window.addEventListener('resize', function () { rect = null; }, { passive: true });
    });
  }

  // ── Number count-up on scroll into view ─────────────────────────
  function initCountUp() {
    if (!('IntersectionObserver' in window)) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function fmt(n, dec, prefix, suffix) {
      var s = n.toFixed(dec);
      // Add thousands separators on the integer part only
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return (prefix || '') + parts.join('.') + (suffix || '');
    }

    function run(el) {
      var to = parseFloat(el.dataset.to);
      var dec = (String(el.dataset.to).split('.')[1] || '').length;
      var prefix = el.dataset.prefix || '';
      var suffix = el.dataset.suffix || '';
      if (reduce) { el.textContent = fmt(to, dec, prefix, suffix); return; }
      var dur = parseInt(el.dataset.dur || '1400', 10);
      var t0 = performance.now();
      function tick(now) {
        var k = Math.min(1, (now - t0) / dur);
        el.textContent = fmt(to * ease(k), dec, prefix, suffix);
        if (k < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !e.target.dataset.done) {
          e.target.dataset.done = '1';
          run(e.target);
        }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('[data-to]').forEach(function (el) { io.observe(el); });
  }

  // ── Conic dial fill on scroll into view ─────────────────────────
  function initDial() {
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('dial-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('.dial').forEach(function (el) { io.observe(el); });
  }

  // ── Word-by-word splitting for `.reveal-words` ─────────────────
  function initWordReveal() {
    document.querySelectorAll('.reveal-words').forEach(function (p) {
      var text = p.textContent.trim();
      if (!text) return;
      p.innerHTML = text.split(/(\s+)/).map(function (chunk, i) {
        if (/^\s+$/.test(chunk)) return chunk;
        return '<span class="w" style="--i:' + i + '">' + chunk + '</span>';
      }).join('');
    });
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    initPillNav();
    initReveal();
    injectYear();
    initClock();
    initSpotlight();
    initMagneticButtons();
    initWordReveal();
    initCountUp();
    initDial();
    initContactForm();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
