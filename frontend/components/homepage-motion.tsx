'use client';

import { useEffect } from 'react';

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

  return null;
}
