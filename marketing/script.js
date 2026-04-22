/* ======================================================================
   Shop OS — Marketing Site JS
   Vanilla JS, no framework.
   ====================================================================== */

(function () {
  'use strict';

  // ── Mobile nav toggle ─────────────────────────────────────────────
  function initMobileNav() {
    const toggle = document.querySelector('[data-nav-toggle]');
    const drawer = document.querySelector('[data-mobile-nav]');
    if (!toggle || !drawer) return;

    const openIcon = toggle.querySelector('[data-icon-open]');
    const closeIcon = toggle.querySelector('[data-icon-close]');

    function setOpen(open) {
      drawer.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (openIcon && closeIcon) {
        openIcon.style.display = open ? 'none' : '';
        closeIcon.style.display = open ? '' : 'none';
      }
      document.body.style.overflow = open ? 'hidden' : '';
    }

    toggle.addEventListener('click', function () {
      const isOpen = drawer.classList.contains('open');
      setOpen(!isOpen);
    });

    // Close when a link is clicked
    drawer.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { setOpen(false); });
    });

    // Close on resize up
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', function () {
      const w = window.innerWidth;
      if (w !== lastWidth && w >= 768) setOpen(false);
      lastWidth = w;
    });
  }

  // ── FAQ accordion ─────────────────────────────────────────────────
  function initFaq() {
    document.querySelectorAll('.faq-trigger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const item = btn.closest('.faq-item');
        if (!item) return;
        const isOpen = item.classList.contains('open');

        // Optional: close siblings (accordion style)
        const group = item.parentElement;
        if (group) {
          group.querySelectorAll('.faq-item.open').forEach(function (x) {
            if (x !== item) x.classList.remove('open');
          });
        }
        item.classList.toggle('open', !isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
      });
    });
  }

  // ── Pricing monthly/yearly toggle ─────────────────────────────────
  function initPriceToggle() {
    const toggle = document.querySelector('[data-price-toggle]');
    if (!toggle) return;

    const buttons = toggle.querySelectorAll('button[data-billing]');
    const monthlyPrices = document.querySelectorAll('[data-price-monthly]');
    const yearlyPrices = document.querySelectorAll('[data-price-yearly]');
    const monthlyLabels = document.querySelectorAll('[data-label-monthly]');
    const yearlyLabels = document.querySelectorAll('[data-label-yearly]');

    function setBilling(mode) {
      buttons.forEach(function (b) {
        b.classList.toggle('active', b.dataset.billing === mode);
      });
      monthlyPrices.forEach(function (el) { el.style.display = mode === 'monthly' ? '' : 'none'; });
      yearlyPrices.forEach(function (el) { el.style.display = mode === 'yearly' ? '' : 'none'; });
      monthlyLabels.forEach(function (el) { el.style.display = mode === 'monthly' ? '' : 'none'; });
      yearlyLabels.forEach(function (el) { el.style.display = mode === 'yearly' ? '' : 'none'; });
    }

    buttons.forEach(function (b) {
      b.addEventListener('click', function () { setBilling(b.dataset.billing); });
    });

    setBilling('monthly');
  }

  // ── Scroll reveal (IntersectionObserver) ──────────────────────────
  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length || !('IntersectionObserver' in window)) {
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
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  // ── Lucide icon render (deferred until the CDN script loads) ──────
  function initLucide() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    } else {
      // Retry briefly in case CDN is slow
      let tries = 0;
      const t = setInterval(function () {
        tries += 1;
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          window.lucide.createIcons();
          clearInterval(t);
        } else if (tries > 20) {
          clearInterval(t);
        }
      }, 150);
    }
  }

  // ── Year injection for footer ─────────────────────────────────────
  function injectYear() {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  // ── Contact form (demo only, no backend) ──────────────────────────
  function initContactForm() {
    const form = document.querySelector('[data-contact-form]');
    if (!form) return;
    const successEl = form.querySelector('[data-success]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
      // Simulate delivery; real site would POST to /api or Netlify Forms
      setTimeout(function () {
        form.reset();
        if (successEl) successEl.style.display = 'block';
        if (btn) { btn.disabled = false; btn.textContent = 'Send message'; }
      }, 700);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    initMobileNav();
    initFaq();
    initPriceToggle();
    initReveal();
    initLucide();
    injectYear();
    initContactForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
