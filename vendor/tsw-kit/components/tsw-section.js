import { wrapInner, observeReveal } from './shared.js';

export class TswSection extends HTMLElement {
  connectedCallback() {
    wrapInner(this, 'tsw-section__inner');
    observeReveal(this);
  }
}

customElements.define('tsw-section', TswSection);
