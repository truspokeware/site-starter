export class TswCard extends HTMLElement {
  connectedCallback() {
    const link = this.querySelector('a[href]');
    if (!link) return;

    this.setAttribute('data-interactive', 'true');
    link.setAttribute('data-tsw-card-link', '');
  }
}

customElements.define('tsw-card', TswCard);
