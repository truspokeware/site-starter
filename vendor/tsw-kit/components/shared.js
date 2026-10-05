const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

export const reducedMotion = () => REDUCED.matches;

export function once(name) {
  if (!once.cache) once.cache = new Map();
  if (!once.cache.has(name)) once.cache.set(name, new Set());
  const set = once.cache.get(name);
  return (fn) => {
    if (set.has(fn)) return;
    set.add(fn);
    fn();
  };
}

export function warnOnce(name, message) {
  const run = once(`warn:${name}`);
  run(() => console.warn(`[tsw] ${name}: ${message}`));
}

export function observeReveal(root = document) {
  if (reducedMotion()) return;
  if (!('IntersectionObserver' in window)) return;

  const targets = root.querySelectorAll('[data-tsw-reveal]:not([data-tsw-revealed])');
  if (!targets.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-tsw-revealed', '');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );

  for (const el of targets) io.observe(el);
}

export function wrapInner(host, className) {
  let inner = host.querySelector(':scope > .' + className);
  if (inner) return inner;

  inner = document.createElement('div');
  inner.className = className;
  const frag = document.createDocumentFragment();
  while (host.firstChild) frag.append(host.firstChild);
  inner.append(frag);
  host.append(inner);
  return inner;
}
