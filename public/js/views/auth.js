import { h, field, setBusy, toast } from '../ui.js';
import { api } from '../api.js';
import { setSession, go } from '../store.js';

export function authView({ params }) {
  const registering = params[0] === 'register';
  const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '';
  const err = h('p', { class: 'form-error', role: 'alert' });

  const name = h('input', { type: 'text', autocomplete: 'name', required: true });
  const mobile = h('input', { type: 'tel', autocomplete: 'tel', inputmode: 'numeric', maxlength: 14, required: true });
  const email = h('input', { type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { type: 'password', autocomplete: registering ? 'new-password' : 'current-password', required: true, minlength: registering ? 8 : null });
  const submit = h('button', { class: 'btn', type: 'submit' }, registering ? 'Create account' : 'Sign in');

  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      setBusy(submit, true);
      try {
        const body = registering
          ? { name: name.value, mobile: mobile.value, email: email.value, password: password.value }
          : { email: email.value, password: password.value };
        const res = await api.post(registering ? '/auth/register' : '/auth/login', body);
        setSession(res);
        toast(`Welcome, ${res.user.name.split(' ')[0]}`, 'ok');
        go(next || (res.user.role === 'owner' ? '/owner' : '/'));
      } catch (e2) {
        err.textContent = e2.message;
      } finally {
        setBusy(submit, false);
      }
    },
  },
  registering ? field('Full name', name) : null,
  registering ? field('Mobile number', mobile) : null,
  field('Email', email),
  field('Password', password, registering ? 'At least 8 characters' : null),
  err, submit);

  const fillDemo = (who) => h('button', {
    type: 'button', class: 'btn btn--ghost btn--sm',
    onclick: () => { email.value = `${who}@demo.in`; password.value = 'Demo@1234'; },
  }, `Fill ${who} demo`);

  return h('section', { class: 'page narrow' },
    h('div', { class: 'card' },
      h('h1', {}, registering ? 'Create your account' : 'Sign in'),
      h('p', { class: 'muted' }, registering ? 'Customers can book circuits and keep their QR tickets.' : 'Customers see their tickets here. Travel owners manage circuits and check-in.'),
      form,
      h('p', { class: 'muted small' }, registering ? 'Already have an account? ' : 'New here? ',
        h('a', { href: registering ? `#/login${next ? `?next=${encodeURIComponent(next)}` : ''}` : `#/register${next ? `?next=${encodeURIComponent(next)}` : ''}` }, registering ? 'Sign in' : 'Create an account')),
      registering ? null : h('div', { class: 'demo-box' },
        h('p', { class: 'small' }, 'Demo accounts (password Demo@1234)'),
        h('div', { class: 'row' }, fillDemo('customer'), fillDemo('owner')))));
}
