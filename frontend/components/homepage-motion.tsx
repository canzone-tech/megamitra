'use client';

import { useEffect } from 'react';
// A bounded, deterministic spray keeps the cursor trail elegant and lightweight.
// Values are decorative offsets in CSS pixels, not application/business data.
const CURSOR_EMIT_INTERVAL_MS = 42;
const CURSOR_MIN_DISTANCE_PX = 8;
const CURSOR_MAX_PARTICLES = 42;
const CURSOR_PARTICLES_PER_EMIT = 3;
const CURSOR_SPREAD = [
  { x: -5, y: 4, dx: -24, dy: -19 },
  { x: 8, y: -4, dx: 28, dy: -27 },
  { x: -9, y: -6, dx: -21, dy: -38 },
  { x: 4, y: 7, dx: 17, dy: 28 },
  { x: 3, y: -9, dx: 8, dy: -40 },
  { x: -6, y: 6, dx: -29, dy: 21 },
  { x: 7, y: 3, dx: 32, dy: 11 },
  { x: -2, y: -8, dx: -6, dy: -31 },
] as const;


// This is presentational-only. The page remains readable without JS, and
// below-fold content is hidden only after the observer has been installed.
export default function HomepageMotion() {
  useEffect(() => {
    if (!('IntersectionObserver' in window) ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('mm-home-reveal-pending');
        entry.target.classList.add('mm-home-reveal-visible');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -28px 0px', threshold: 0.08 });

    const elements = document.querySelectorAll<HTMLElement>('.mm-home [data-home-reveal]');
    for (const element of elements) {
      // Never conceal content already visible on first paint or on back navigation.
      if (element.getBoundingClientRect().top <= window.innerHeight - 24) continue;
      element.classList.add('mm-home-reveal-pending');
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      // Also restore readability if the component unmounts mid-scroll.
      for (const element of elements) element.classList.remove('mm-home-reveal-pending');
    };
  }, []);


  useEffect(() => {
    const home = document.querySelector<HTMLElement>('.mm-home');
    if (!home) return;

    // Pointer media queries can be false on Linux/remote desktops even when
    // a mouse is active. Use the actual pointerType plus responsive width.
    const desktopWidth = window.matchMedia('(min-width: 681px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const layer = document.createElement('div');
    layer.className = 'mm-home-cursor-trail';
    layer.setAttribute('aria-hidden', 'true');
    home.appendChild(layer);

    const activeParticles = new Set<HTMLSpanElement>();
    let lastEmissionTime = Number.NEGATIVE_INFINITY;
    let lastEmissionX = Number.NEGATIVE_INFINITY;
    let lastEmissionY = Number.NEGATIVE_INFINITY;
    let particleSequence = 0;

    const removeParticle = (particle: HTMLSpanElement) => {
      activeParticles.delete(particle);
      particle.remove();
    };
    const clearParticles = () => {
      for (const particle of activeParticles) particle.remove();
      activeParticles.clear();
    };
    const allowed = () =>
      desktopWidth.matches && !reducedMotion.matches && !document.hidden;

    const onPointerMove = (event: PointerEvent) => {
      if (!allowed() || !event.isPrimary || event.pointerType !== 'mouse') return;
      const deltaX = event.clientX - lastEmissionX;
      const deltaY = event.clientY - lastEmissionY;
      if (event.timeStamp - lastEmissionTime < CURSOR_EMIT_INTERVAL_MS ||
          deltaX * deltaX + deltaY * deltaY < CURSOR_MIN_DISTANCE_PX ** 2) return;
      lastEmissionTime = event.timeStamp;
      lastEmissionX = event.clientX;
      lastEmissionY = event.clientY;

      for (let i = 0; i < CURSOR_PARTICLES_PER_EMIT; i++) {
        if (activeParticles.size >= CURSOR_MAX_PARTICLES) {
          const oldest = activeParticles.values().next().value;
          if (oldest) removeParticle(oldest);
        }
        const offset = CURSOR_SPREAD[particleSequence % CURSOR_SPREAD.length];
        const sparkle = document.createElement('span');
        sparkle.className = particleSequence % 4 === 0
          ? 'mm-home-cursor-spark mm-home-cursor-spark-star'
          : 'mm-home-cursor-spark';
        sparkle.style.left = `${event.clientX + offset.x}px`;
        sparkle.style.top = `${event.clientY + offset.y}px`;
        sparkle.style.setProperty('--mm-home-scatter-x', `${offset.dx}px`);
        sparkle.style.setProperty('--mm-home-scatter-y', `${offset.dy}px`);
        sparkle.addEventListener('animationend', () => removeParticle(sparkle), { once: true });
        activeParticles.add(sparkle);
        layer.appendChild(sparkle);
        particleSequence++;
      }
    };

    // Live preference/visibility changes immediately clear existing particles.
    const onPreferencesChange = () => {
      if (!allowed()) {
        clearParticles();
        lastEmissionTime = Number.NEGATIVE_INFINITY;
      }
    };
    home.addEventListener('pointermove', onPointerMove, { passive: true });
    desktopWidth.addEventListener('change', onPreferencesChange);
    reducedMotion.addEventListener('change', onPreferencesChange);
    document.addEventListener('visibilitychange', onPreferencesChange);

    return () => {
      home.removeEventListener('pointermove', onPointerMove);
      desktopWidth.removeEventListener('change', onPreferencesChange);
      reducedMotion.removeEventListener('change', onPreferencesChange);
      document.removeEventListener('visibilitychange', onPreferencesChange);
      clearParticles();
      layer.remove();
    };
  }, []);

  return null;
}
