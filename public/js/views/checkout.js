import { h, field, rupees, setBusy, toast } from '../ui.js';
import { api } from '../api.js';
import { state, go, clearCart } from '../store.js';

const FEE_RATE = 0.02; // preview only; the server computes the real total

export async function checkoutView() {
  if (!state.user) { go('/login?next=%2Fcheckout'); return null; }
  if (state.user.role !== 'customer') {
    return h('section', { class: 'page narrow' }, h('div', { class: 'card' },
      h('h1', {}, 'Customer accounts only'), h('p', {}, 'Travel owners cannot book circuits. Sign in with a customer account.')));
  }
  if (!state.cart.size) { go('/'); return null; }

  const { circuits } = await api.get('/circuits');
  const chosen = circuits.filter((c) => state.cart.has(c.id));
  if (!chosen.length) { clearCart(); go('/'); return null; }

  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const form = { travellerName: state.user.name, mobile: state.user.mobile || '', email: state.user.email, travelDate: tomorrow, travellers: 2 };
  let step = 1;
  let order = null;
  let method = 'upi';
  let banks = [];

  const root = h('section', { class: 'page' });
  const stepTabs = h('div', { class: 'filters', 'aria-label': 'Checkout steps' });
  const left = h('div', { class: 'card checkout__main' });
  const right = h('aside', { class: 'card checkout__summary' });

  function summary() {
    const n = order ? order.travellers : form.travellers;
    const lines = order
      ? order.items.map((i) => [`${i.name} × ${order.travellers}`, i.amount])
      : chosen.map((c) => [`${c.name} × ${n}`, c.price * n]);
    const subtotal = order ? order.subtotal : lines.reduce((s, l) => s + l[1], 0);
    const fee = order ? order.fee : Math.round(subtotal * FEE_RATE);
    right.replaceChildren(
      h('h2', {}, 'Your trip'),
      h('dl', { class: 'summary' },
        ...lines.flatMap(([label, amt]) => [h('dt', {}, label), h('dd', {}, rupees(amt))]),
        h('dt', {}, 'Convenience fee (2%)'), h('dd', {}, rupees(fee)),
        h('dt', { class: 'total' }, 'Total'), h('dd', { class: 'total' }, rupees(subtotal + fee))),
      h('p', { class: 'muted small' }, 'One QR ticket is issued for each circuit.'));
  }

  function paintTabs() {
    stepTabs.replaceChildren(
      h('span', { class: `pill ${step === 1 ? 'is-active' : ''}` }, 'Traveller details'),
      h('span', { class: `pill ${step === 2 ? 'is-active' : ''}` }, 'Payment'),
      h('span', { class: 'pill' }, 'Tickets'));
  }

  function detailsStep() {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const inName = h('input', { type: 'text', value: form.travellerName, autocomplete: 'name', required: true });
    const inMobile = h('input', { type: 'tel', value: form.mobile, autocomplete: 'tel', inputmode: 'numeric', required: true });
    const inEmail = h('input', { type: 'email', value: form.email, autocomplete: 'email' });
    const inDate = h('input', { type: 'date', value: form.travelDate, min: new Date().toISOString().slice(0, 10), required: true });
    const inTrav = h('select', {}, ...Array.from({ length: 10 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === form.travellers }, String(i + 1))));
    inTrav.addEventListener('change', () => { form.travellers = Number(inTrav.value); summary(); });
    const next = h('button', { class: 'btn', type: 'submit' }, 'Continue to payment');

    left.replaceChildren(h('h2', {}, 'Who is travelling?'),
      h('form', {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          Object.assign(form, { travellerName: inName.value, mobile: inMobile.value, email: inEmail.value, travelDate: inDate.value, travellers: Number(inTrav.value) });
          setBusy(next, true);
          try {
            const res = await api.post('/orders', { ...form, circuitIds: [...state.cart] });
            order = res.order; banks = res.banks; step = 2;
            paint();
          } catch (e2) { err.textContent = e2.message; } finally { setBusy(next, false); }
        },
      },
      field('Full name', inName),
      h('div', { class: 'two' }, field('Mobile number', inMobile), field('Email (optional)', inEmail)),
      h('div', { class: 'two' }, field('Travel date', inDate), field('Travellers', inTrav)),
      err,
      h('div', { class: 'row' }, next, h('a', { class: 'btn btn--ghost', href: '#/' }, 'Back'))));
  }

  function paymentStep() {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const inUpi = h('input', { type: 'text', placeholder: 'name@upi', autocomplete: 'off', value: 'demo@upi' });
    const inCard = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '4242 4242 4242 4242' });
    const inExp = h('input', { type: 'text', autocomplete: 'cc-exp', placeholder: 'MM/YY', maxlength: 5 });
    const inCvv = h('input', { type: 'password', autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: 4 });
    const inBank = h('select', {}, h('option', { value: '' }, 'Choose your bank'), ...banks.map((b) => h('option', { value: b }, b)));
    const pay = h('button', { class: 'btn', type: 'submit' }, `Pay ${rupees(order.total)}`);

    const fields = {
      upi: [field('UPI ID', inUpi)],
      card: [field('Card number', inCard), h('div', { class: 'two' }, field('Expiry', inExp), field('CVV', inCvv)),
        h('p', { class: 'hint' }, 'Demo: use 4242 4242 4242 4242. A card ending 0002 simulates a bank decline.')],
      netbanking: [field('Bank', inBank)],
    };

    const methodPills = h('div', { class: 'filters', role: 'group', 'aria-label': 'Payment method' },
      ...[['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net banking']].map(([k, label]) =>
        h('button', { type: 'button', class: `pill ${method === k ? 'is-active' : ''}`, 'aria-pressed': String(method === k), onclick: () => { method = k; paint(); } }, label)));

    left.replaceChildren(h('h2', {}, 'Pay securely'), methodPills,
      h('form', {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          const payment = method === 'upi' ? { method, upiId: inUpi.value }
            : method === 'card' ? { method, cardNumber: inCard.value, expiry: inExp.value, cvv: inCvv.value }
              : { method, bank: inBank.value };
          setBusy(pay, true, 'Processing…');
          try {
            const res = await api.post(`/orders/${order.id}/pay`, { payment });
            state.justPaid = res.bookings;
            clearCart();
            toast('Payment received', 'ok');
            go('/tickets');
          } catch (e2) { err.textContent = e2.message; } finally { setBusy(pay, false); }
        },
      },
      ...fields[method],
      h('p', { class: 'muted small' }, 'Demo mode: no money is charged.'),
      err,
      h('div', { class: 'row' }, pay, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { step = 1; order = null; paint(); } }, 'Back'))));
  }

  function paint() {
    paintTabs();
    summary();
    step === 1 ? detailsStep() : paymentStep();
  }

  root.append(stepTabs, h('div', { class: 'checkout' }, left, right));
  paint();
  return root;
}
