import { h, fmtDate, typeClass } from '../ui.js';
import { api } from '../api.js';
import { state, go } from '../store.js';

export async function ticketsView() {
  if (!state.user) { go('/login?next=%2Ftickets'); return null; }
  if (state.user.role !== 'customer') {
    return h('section', { class: 'page narrow' }, h('div', { class: 'card' }, h('h1', {}, 'Customer accounts only')));
  }

  const fresh = state.justPaid;
  state.justPaid = null;
  const bookings = fresh || (await api.get('/bookings')).bookings;

  const ticket = (b) => h('article', { class: `ticket ${typeClass(b.circuit.type)}` },
    h('h3', {}, b.circuit.name),
    h('p', { class: 'muted small' }, `${b.circuit.days} day${b.circuit.days > 1 ? 's' : ''}, ${fmtDate(b.travelDate)}, ${b.travellers} traveller${b.travellers > 1 ? 's' : ''}`),
    h('img', { class: 'ticket__qr', src: b.qr, width: 160, height: 160, alt: `QR code for booking ${b.code}` }),
    h('p', { class: 'code' }, b.code),
    h('p', { class: 'small' }, b.operator),
    h('span', { class: `status ${b.status === 'checked_in' ? 'status--done' : ''}` }, b.status === 'checked_in' ? 'Checked in' : 'Confirmed'),
    h('p', { class: 'muted small' }, 'Show this QR to the operator at the first stop.'));

  return h('section', { class: 'page' },
    h('div', { class: 'page__head' },
      h('div', {},
        h('h1', {}, fresh ? 'Payment received' : 'My bookings'),
        h('p', { class: 'muted' }, fresh
          ? `${bookings.length} circuit${bookings.length > 1 ? 's' : ''} booked. Each circuit has its own QR ticket.`
          : bookings.length ? 'Your tickets are kept here. Print them or show the QR on your phone.' : 'No bookings yet.')),
      bookings.length ? h('button', { class: 'btn btn--ghost no-print', onclick: () => window.print() }, 'Print tickets') : null),
    bookings.length
      ? h('div', { class: 'tickets' }, bookings.map(ticket))
      : h('div', { class: 'card' }, h('p', {}, 'Find a circuit and book your first trip.'), h('a', { class: 'btn', href: '#/' }, 'Browse circuits')));
}
