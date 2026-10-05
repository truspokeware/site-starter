import { warnOnce } from './shared.js';

export class TswDisclosure extends HTMLElement {
  connectedCallback() {
    if (this.querySelector(':scope > .tsw-disclosure__body')) return;

    const summary = this.querySelector(':scope > summary');
    if (!summary) {
      warnOnce(`disclosure:${this.id || 'anon'}`, 'missing <summary> child');
      return;
    }

    const body = document.createElement('div');
    body.className = 'tsw-disclosure__body';
    while (summary.nextSibling) body.append(summary.nextSibling);
    this.append(body);
  }
}

customElements.define('tsw-disclosure', TswDisclosure);
