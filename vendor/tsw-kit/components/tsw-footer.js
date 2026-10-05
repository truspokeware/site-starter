export class TswFooter extends HTMLElement {
  connectedCallback() {
    for (const slot of this.querySelectorAll('[data-tsw-year]')) {
      slot.textContent = String(new Date().getFullYear());
    }
  }
}

customElements.define('tsw-footer', TswFooter);
