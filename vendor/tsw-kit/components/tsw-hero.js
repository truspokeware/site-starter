import { wrapInner, observeReveal } from './shared.js';

export class TswHero extends HTMLElement {
  connectedCallback() {
    wrapInner(this, 'tsw-hero__inner');
    observeReveal(this);
  }
}

customElements.define('tsw-hero', TswHero);
