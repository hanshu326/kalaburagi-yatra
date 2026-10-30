import { h, toast } from './ui.js';
import { state, loadUser, signOut, onChange, go } from './store.js';
import { authView } from './views/auth.js';
import { browseView } from './views/browse.js';
import { checkoutView } from './views/checkout.js';
import { ticketsView } from './views/tickets.js';
import { ownerView } from './views/owner.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

const routes = [
  [/^\/?$/, browseView],
  [/^\/checkout$/, checkoutView],
  [/^\/tickets$/, ticketsView],
  [/^\/owner(?:\/(overview|packages|bookings|checkin))?$/, ownerView],
  [/^\/(login|register)$/, authView],
];

function renderNav(path) {
  const isOwnerArea = path.startsWith('/owner');
  const u = state.user;
  nav.replaceChildren(
    h('a', { href: '#/', class: `nav__pill ${!isOwnerArea && !path.startsWith('/login') ? 'is-active' : ''}` }, 'Customer'),
    h('a', { href: '#/owner', class: `nav__pill ${isOwnerArea ? 'is-active' : ''}` }, 'Travel owner'),
    h('span', { class: 'nav__soon', title: 'Planned for phase 2' }, 'Admin · Super admin soon'),
    u
      ? h('button', { class: 'nav__pill nav__pill--ghost', onclick: () => { signOut(); go('/'); toast('Signed out'); } }, `Sign out (${u.name.split(' ')[0]})`)
      : h('a', { href: '#/login', class: 'nav__pill nav__pill--ghost' }, 'Sign in'),
  );
}

let renderToken = 0;
async function render() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const mine = ++renderToken;
  renderNav(path);
  for (const [re, view] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    app.setAttribute('aria-busy', 'true');
    try {
      const node = await view({ params: m.slice(1), path });
      if (mine !== renderToken) return; // a newer navigation won
      if (node) app.replaceChildren(node);
    } catch (err) {
      if (mine !== renderToken) return;
      app.replaceChildren(h('section', { class: 'page narrow' },
        h('div', { class: 'card' }, h('h1', {}, 'Something went wrong'), h('p', {}, err.message), h('a', { class: 'btn', href: '#/' }, 'Back to circuits'))));
    } finally {
      app.removeAttribute('aria-busy');
    }
    window.scrollTo(0, 0);
    return;
  }
  app.replaceChildren(h('section', { class: 'page narrow' }, h('div', { class: 'card' }, h('h1', {}, 'Page not found'), h('a', { class: 'btn', href: '#/' }, 'Back to circuits'))));
}

window.addEventListener('hashchange', render);
// Cart changes re-render only the parts that care (views subscribe themselves); nav needs refresh on sign in/out.
onChange(() => renderNav((location.hash.replace(/^#/, '') || '/').split('?')[0]));

await loadUser();
render();
