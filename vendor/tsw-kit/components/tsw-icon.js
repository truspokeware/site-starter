import { ICONS } from '../icons/icons.js';
import { warnOnce } from './shared.js';

const SIZES = {
  '2xs': '0.75rem',
  xs: '0.875rem',
  sm: '1rem',
  md: '1.25rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '2.5rem',
  '3xl': '3rem'
};

const TEMPLATE = document.createElement('template');

export class TswIcon extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'size', 'label', 'stroke'];
  }

  #render() {
    const name = this.getAttribute('name');
    const svg = name ? ICONS[name] : undefined;

    if (!svg) {
      if (name) warnOnce(`icon:${name}`, `unknown icon "${name}"`);
      this.replaceChildren();
      return;
    }

    const size = this.getAttribute('size');
    if (size) {
      this.style.setProperty('--tsw-icon-size', SIZES[size] ?? size);
    }

    const stroke = this.getAttribute('stroke');
    if (stroke) this.style.setProperty('--tsw-icon-stroke', stroke);

    TEMPLATE.innerHTML = svg;
    const node = TEMPLATE.content.firstElementChild.cloneNode(true);
    const label = this.getAttribute('label');

    if (label) {
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', label);
    } else {
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('focusable', 'false');
    }

    this.replaceChildren(node);
  }

  connectedCallback() {
    this.#render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#render();
  }
}

customElements.define('tsw-icon', TswIcon);
