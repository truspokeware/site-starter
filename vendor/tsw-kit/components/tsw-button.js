const VARIANT = new Set(['primary', 'secondary', 'ghost']);

export class TswButton extends HTMLElement {
  static get observedAttributes() {
    return ['href', 'type', 'disabled', 'loading', 'variant', 'size', 'block'];
  }

  #control = null;

  #mirror() {
    for (const attr of ['variant', 'size', 'block', 'loading']) {
      const value = this.getAttribute(attr);
      if (value == null) continue;
      if (value === false || value === 'false') continue;
      this.setAttribute(`data-${attr}`, value);
    }
  }

  #requiredTag() {
    return this.hasAttribute('href') ? 'a' : 'button';
  }

  #ensureControl() {
    const tag = this.#requiredTag();

    if (this.#control && this.#control.tagName.toLowerCase() === tag) return this.#control;

    const previous = this.#control;
    const control = document.createElement(tag);
    control.className = 'tsw-button__control';

    if (previous) {
      control.append(...previous.childNodes);
      previous.replaceWith(control);
    } else {
      control.append(...this.childNodes);
      this.append(control);
    }

    this.#control = control;
    return control;
  }

  #sync() {
    const control = this.#ensureControl();

    for (const attr of [...control.attributes]) {
      if (attr.name !== 'class') control.removeAttribute(attr.name);
    }

    const href = this.getAttribute('href');
    if (href) {
      control.setAttribute('href', href);
      const external = /^https?:\/\//i.test(href) && !href.includes(location.host);
      if (external) {
        control.setAttribute('rel', 'noopener');
        control.setAttribute('target', '_blank');
      }
    } else {
      control.setAttribute('type', this.getAttribute('type') || 'button');
    }

    const disabled = this.hasAttribute('disabled') || this.getAttribute('data-loading') === 'true';
    control.setAttribute('aria-disabled', String(disabled));
    if (control.tagName.toLowerCase() === 'button') control.disabled = disabled;

    if (!VARIANT.has(this.getAttribute('data-variant'))) this.setAttribute('data-variant', 'primary');
    if (this.getAttribute('data-loading') === 'true') control.setAttribute('aria-busy', 'true');
    else control.removeAttribute('aria-busy');

    if (control.tagName.toLowerCase() === 'a') {
      const focusable = this.getAttribute('href') ? 'true' : 'false';
      control.setAttribute('tabindex', disabled ? '-1' : focusable);
    }
  }

  connectedCallback() {
    this.#mirror();
    this.#sync();
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (['variant', 'size', 'block', 'loading'].includes(name)) this.#mirror();
    this.#sync();
  }

  focus(options) {
    this.#ensureControl().focus(options);
  }
}

customElements.define('tsw-button', TswButton);
