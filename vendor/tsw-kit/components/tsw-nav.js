
import { wrapInner } from './shared.js';

export class TswNav extends HTMLElement {

  #toggle = null;
  #panel = null;
  #onScroll = null;
  #onKeydown = null;
  #onPointerDown = null;
  #currentObserver = null;

  #setupSticky() {
    const update = () => {
      this.setAttribute('data-stuck', String(window.scrollY > 8));
    };
    this.#onScroll = update;
    update();
    window.addEventListener('scroll', this.#onScroll, { passive: true });
  }

  #setupToggle() {
    this.#toggle = this.querySelector('[slot="toggle"]');
    this.#panel = this.querySelector('[slot="panel"]');

    if (!this.#toggle || !this.#panel) return;

    const panelId = this.#panel.id || (this.#panel.id = `tsw-nav-panel-${Math.random().toString(36).slice(2, 9)}`);
    this.#toggle.setAttribute('aria-controls', panelId);
    this.#toggle.setAttribute('aria-expanded', 'false');

    this.setAttribute('data-open', 'false');

    const setOpen = (open) => {
      this.setAttribute('data-open', String(open));
      this.#toggle.setAttribute('aria-expanded', String(open));
      if (open) this.#panel.removeAttribute('inert');
      else {
        this.#panel.setAttribute('inert', '');
        this.#toggle.focus();
      }
    };

    this.#toggle.addEventListener('click', () => {
      setOpen(this.getAttribute('data-open') !== 'true');
    });

    this.#panel.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });

    this.#onKeydown = (event) => {
      if (event.key !== 'Escape') return;
      if (this.getAttribute('data-open') !== 'true') return;
      setOpen(false);
    };
    document.addEventListener('keydown', this.#onKeydown);

    this.#onPointerDown = (event) => {
      if (this.getAttribute('data-open') !== 'true') return;
      if (this.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', this.#onPointerDown, true);
  }

  #setupCurrentLink() {
    if (!('IntersectionObserver' in window)) return;

    const links = [...this.querySelectorAll('[slot="links"] a[href^="#"], [slot="panel"] a[href^="#"]')];
    if (!links.length) return;

    const byId = new Map();
    for (const link of links) {
      const id = link.getAttribute('href').slice(1);
      if (id) byId.set(id, [...(byId.get(id) || []), link]);
    }

    const visible = new Set();

    this.#currentObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }

        let activeId = null;
        let bestTop = Infinity;
        for (const id of visible) {
          const top = document.getElementById(id)?.getBoundingClientRect().top ?? Infinity;
          if (top < bestTop) {
            bestTop = top;
            activeId = id;
          }
        }

        for (const link of links) link.removeAttribute('aria-current');
        if (activeId) {
          for (const link of byId.get(activeId) || []) link.setAttribute('aria-current', 'true');
        }
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );

    for (const id of byId.keys()) {
      const section = document.getElementById(id);
      if (section) this.#currentObserver.observe(section);
    }
  }

  connectedCallback() {
    wrapInner(this, 'tsw-nav__inner');
    this.#setupSticky();
    this.#setupToggle();
    this.#setupCurrentLink();
  }

  disconnectedCallback() {
    if (this.#onScroll) window.removeEventListener('scroll', this.#onScroll);
    if (this.#onKeydown) document.removeEventListener('keydown', this.#onKeydown);
    if (this.#onPointerDown) document.removeEventListener('pointerdown', this.#onPointerDown, true);
    this.#currentObserver?.disconnect();
  }
}

customElements.define('tsw-nav', TswNav);
