import { h, rupees, typeClass } from '../ui.js';
import { api } from '../api.js';
import { state, toggleCircuit, go } from '../store.js';

export async function browseView() {
  const { circuits, types } = await api.get('/circuits');
  let filter = 'All';

  const root = h('section', { class: 'page' });
  const grid = h('div', { class: 'grid', role: 'list' });
  const pills = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by circuit type' });
  const tripBar = h('div', { class: 'tripbar', 'aria-live': 'polite' });

  function card(c) {
    const inTrip = state.cart.has(c.id);
    return h('article', { class: `circuit ${typeClass(c.type)}`, role: 'listitem' },
      h('div', { class: 'circuit__band' }, `${c.type}, ${c.days} day${c.days > 1 ? 's' : ''}`),
      h('div', { class: 'circuit__body' },
        h('h3', {}, c.name),
        h('p', { class: 'muted small' }, c.stops),
        h('p', { class: 'muted small' }, `By ${c.operator}`),
        h('div', { class: 'circuit__foot' },
          h('strong', { class: 'price' }, rupees(c.price)),
          h('button', {
            class: `btn btn--sm ${inTrip ? 'btn--ghost' : ''}`,
            'aria-pressed': String(inTrip),
            'aria-label': `${inTrip ? 'Remove' : 'Add'} ${c.name} ${inTrip ? 'from' : 'to'} trip`,
            onclick: () => { toggleCircuit(c.id); paint(); },
          }, inTrip ? 'Remove' : 'Add to trip'))));
  }

  function paint() {
    // drop ids that are no longer listed
    for (const id of [...state.cart]) if (!circuits.some((c) => c.id === id)) state.cart.delete(id);

    pills.replaceChildren(...['All', ...types].map((t) =>
      h('button', { class: `pill ${t === filter ? 'is-active' : ''}`, 'aria-pressed': String(t === filter), onclick: () => { filter = t; paint(); } }, t)),
      h('a', { class: 'pill pill--link', href: '#/tickets' }, 'My bookings'));

    const shown = circuits.filter((c) => filter === 'All' || c.type === filter);
    grid.replaceChildren(...(shown.length ? shown.map(card) : [h('p', { class: 'muted' }, 'No circuits in this category yet.')]));

    const n = state.cart.size;
    tripBar.classList.toggle('is-hidden', n === 0);
    tripBar.replaceChildren(
      h('span', {}, `${n} circuit${n === 1 ? '' : 's'} selected, ${n} QR ticket${n === 1 ? '' : 's'}`),
      h('button', { class: 'btn btn--gold', onclick: () => go('/checkout') }, 'Book now'));
  }

  root.append(
    h('div', { class: 'hero' },
      h('div', { class: 'hero__text' },
        h('h1', {}, 'Book a Kalaburagi circuit in two minutes'),
        h('p', {}, 'Pick a heritage, pilgrimage, nature or youth circuit, pay online, and get a QR ticket for every circuit you book.')),
      h('div', { class: 'hero__arches', 'aria-hidden': 'true' }, h('i', {}), h('i', {}), h('i', {}))),
    pills, grid, tripBar);
  paint();
  return root;
}
