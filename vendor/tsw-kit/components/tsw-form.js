import { warnOnce } from './shared.js';

const CONTROL = 'input, select, textarea, button';

export class TswForm extends HTMLFormElement {
  static get observedAttributes() {
    return ['endpoint', 'state'];
  }

  #status = null;
  #branches = [];
  #endpoint = '/api/intake';
  #renderedAt = 0;
  #touchedAt = null;
  #invalidFrame = 0;
  #pendingInvalid = null;

  connectedCallback() {
    this.#status = this.querySelector('.tsw-status');
    if (!this.#status) {
      this.#status = document.createElement('p');
      this.#status.className = 'tsw-status';
      this.#status.setAttribute('role', 'status');
      this.#status.setAttribute('aria-live', 'polite');
      this.append(this.#status);
    }

    this.#endpoint = this.getAttribute('endpoint') || this.getAttribute('action') || '/api/intake';
    this.#renderedAt = Date.now();

    this.#setupBranching();
    this.#setupProof();

    this.addEventListener('submit', (event) => this.#onSubmit(event));
    this.addEventListener('input', () => {
      if (this.#touchedAt == null) this.#touchedAt = Date.now();
      this.#clearErrors();
    });
    this.addEventListener('change', () => {
      this.#touchedAt = Date.now();
      this.#applyBranches();
      this.#clearErrors();
    });
    this.addEventListener('invalid', (event) => this.#onInvalid(event), true);
  }

  attributeChangedCallback(name) {
    if (name === 'endpoint' && this.isConnected) {
      this.#endpoint = this.getAttribute("endpoint") || this.getAttribute("action") || "/api/intake";
    }
  }

  #setupBranching() {
    this.#branches = [...this.querySelectorAll('[data-tsw-branch]')];
    for (const fieldset of this.#branches) {
      fieldset.setAttribute('data-tsw-branch-active', 'false');
    }
    this.#applyBranches();
  }

  static markJsAvailable() {
    document.documentElement.setAttribute('data-js', '');
  }

  #applyBranches() {
    for (const fieldset of this.#branches) {
      const key = fieldset.getAttribute('data-tsw-branch');
      const selector = `input[type="radio"][name="${CSS.escape(key)}"]`;
      const radios = [...this.querySelectorAll(selector)];
      const checked = radios.find((r) => r.checked);
      const values = (fieldset.getAttribute('data-tsw-branch-values') || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

      const matches = checked ? values.includes(checked.value) : false;
      fieldset.setAttribute('data-tsw-branch-active', String(matches));
      // Toggle the real `hidden` attribute rather than relying on the
      // `html[data-js]` CSS rule alone. That rule only applies if the page put
      // `data-js` on <html> in an inline head script, and a page that forgets it
      // renders the branch fieldset visible but disabled, which looks broken.
      // This way the fieldset is hidden whenever the branch is inactive, with or
      // without that opt-in, and still visible when there is no JS at all.
      fieldset.hidden = !matches;

      for (const control of fieldset.querySelectorAll(CONTROL)) {
        if (matches) {
          if (control.dataset.tswWasRequired !== undefined) {
            if (control.dataset.tswWasRequired === 'true') control.required = true;
            delete control.dataset.tswWasRequired;
          }
          control.disabled = false;
        } else {
          if (control.required) {
            control.dataset.tswWasRequired = 'true';
            control.required = false;
          }
          control.disabled = true;
        }
      }
    }
  }

  #setupProof() {
    const stamp = this.querySelector('[name="tsw_started_at"]');
    if (stamp && !stamp.value) stamp.value = String(this.#renderedAt);
  }

  #honeypotHit() {
    const trap = this.querySelector('.tsw-honeypot [name], .tsw-honeypot input, .tsw-honeypot textarea');
    return Boolean(trap && trap.value);
  }

  #looksAutomated() {
    return Date.now() - this.#renderedAt < 2500;
  }

  #errorsFor(control) {
    if (control.validity.valueMissing && control.required) return 'This field is required.';
    if (control.validity.typeMismatch) return 'Check the format of this value.';
    if (control.validity.tooShort) return `Use at least ${control.minLength} characters.`;
    if (control.validity.tooLong) return `Keep this under ${control.maxLength} characters.`;
    if (control.validity.patternMismatch) return 'This does not look right.';
    return 'Check this field.';
  }

  #showError(control) {
    if (!control.name) return;
    const field = control.closest('.tsw-field') || control.closest('label')?.parentElement;
    if (!field) return;

    control.setAttribute('aria-invalid', 'true');

    let error = field.querySelector('.tsw-field__error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'tsw-field__error';
      field.append(error);
    }
    error.textContent = this.#errorsFor(control);

    if (!control.getAttribute('aria-describedby')) {
      const id = `${control.id || control.name}-err`;
      error.id = id;
      control.setAttribute('aria-describedby', id);
    }
  }

  #clearErrors() {
    for (const el of this.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid');
    for (const el of this.querySelectorAll('.tsw-field__error')) el.remove();
  }

  #onInvalid(event) {
    this.#showError(event.target);
    this.#pendingInvalid = this.#pendingInvalid || event.target;

    if (this.#invalidFrame) return;
    this.#invalidFrame = requestAnimationFrame(() => {
      this.#invalidFrame = 0;
      if (!this.#pendingInvalid) return;
      this.#pendingInvalid = null;
      this.#setStatus('error', 'Please fix the highlighted fields and try again.');
    });
  }

  #setStatus(tone, message) {
    if (!this.#status) return;
    this.#status.dataset.tone = tone;
    this.#status.textContent = message;
  }

  #collect() {
    const data = {};
    for (const control of this.querySelectorAll('input, select, textarea')) {
      if (control.disabled || control.type === 'file' || control.name.startsWith('tsw_')) continue;
      if (control.type === 'checkbox') {
        data[control.name] = control.checked ? 'yes' : 'no';
        continue;
      }
      if (control.type === 'radio') {
        if (control.checked) data[control.name] = control.value;
        continue;
      }
      if (control.name) data[control.name] = control.value;
    }

    const meta = {
      page: location.pathname,
      referrer: document.referrer || null,
      submittedAt: new Date().toISOString(),
      elapsedMs: Date.now() - this.#renderedAt
    };

    return { ...meta, ...data };
  }

  async #onSubmit(event) {
    event.preventDefault();

    if (this.getAttribute('data-state') === 'submitting') return;

    this.#clearErrors();

    const invalid = [...this.querySelectorAll(CONTROL)].filter(
      (c) => !c.disabled && c.willValidate && !c.checkValidity()
    );

    if (invalid.length) {
      for (const c of invalid) this.#showError(c);
      invalid[0].focus();
      this.#setStatus('error', 'Please fix the highlighted fields and try again.');
      return;
    }

    if (this.#honeypotHit()) {
      this.#setStatus('success', 'Thanks, we have it.');
      return;
    }

    if (this.#looksAutomated()) {
      warnOnce('intake', 'submission dismissed as automated');
      this.#setStatus('success', 'Thanks, we have it.');
      return;
    }

    const payload = this.#collect();
    this.setAttribute('data-state', 'submitting');
    this.#setStatus('pending', 'Sending your details...');

    try {
      const res = await fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      this.#setStatus('success', this.getAttribute('data-success-message') || 'Thanks. We read every one of these and reply within one business day.');
      this.reset();
      for (const fieldset of this.#branches) {
        for (const control of fieldset.querySelectorAll(CONTROL)) control.checked = false;
      }
      this.#applyBranches();
    } catch (err) {
      this.#setStatus('error', `Something went wrong on our end. Please email ${this.getAttribute('data-fallback-email') || 'hello@example.com'} instead.`);
      warnOnce(`intake:submit:${err.message}`, 'intake submit failed');
    } finally {
      this.removeAttribute('data-state');
    }
  }
}

customElements.define('tsw-form', TswForm, { extends: 'form' });

if (document.documentElement.hasAttribute('data-js')) TswForm.markJsAvailable();
