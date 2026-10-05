import { wrapInner, observeReveal } from './shared.js';

export class TswCta extends HTMLElement {
  connectedCallback() {
    wrapInner(this, 'tsw-cta__inner');
    observeReveal(this);
  }
}

customElements.define('tsw-cta', TswCta);
