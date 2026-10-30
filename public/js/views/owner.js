import { h, field, rupees, fmtDate, setBusy, toast, typeClass } from '../ui.js';
import { api } from '../api.js';
import { state, go } from '../store.js';

const TABS = [['overview', 'Overview'], ['packages', 'Packages'], ['bookings', 'Bookings'], ['checkin', 'Check-in']];
let activeOperator = null;

export async function ownerView({ params }) {
  if (!state.user) { go('/login?next=%2Fowner'); return null; }
  if (state.user.role !== 'owner') {
    return h('section', { class: 'page narrow' }, h('div', { class: 'card' },
      h('h1', {}, 'Travel owner area'), h('p', {}, 'This panel is for travel operators. Sign in with an owner account.'),
      h('a', { class: 'btn', href: '#/login' }, 'Sign in as owner')));
  }

  const tab = params[0] || 'overview';
  const { operators } = await api.get('/owner/operators');
  if (!activeOperator || !operators.some((o) => o.id === activeOperator)) activeOperator = operators[0]?.id;
  const q = `?operatorId=${activeOperator}`;

  const select = operators.length > 1
    ? h('select', { 'aria-label': 'Travel business', onchange: (e) => { activeOperator = Number(e.target.value); window.dispatchEvent(new HashChangeEvent('hashchange')); } },
      ...operators.map((o) => h('option', { value: o.id, selected: o.id === activeOperator }, o.name)))
    : null;
  const current = operators.find((o) => o.id === activeOperator);

  const body = h('div', {});
  const view = h('section', { class: 'page' },
    h('div', { class: 'page__head' }, h('h1', {}, current ? current.name : 'Travel owner'), select),
    h('div', { class: 'tabs', role: 'tablist' },
      TABS.map(([k, label]) => h('a', { href: `#/owner/${k}`, class: `tab ${tab === k ? 'is-active' : ''}`, 'aria-current': tab === k ? 'page' : null }, label))),
    body);

  const renderers = { overview, packages, bookings, checkin };
  body.append(await renderers[tab](q));
  return view;
}

async function overview(q) {
  const { stats, nextDepartures } = await api.get(`/owner/overview${q}`);
  const stat = (value, label) => h('div', { class: 'stat' }, h('strong', {}, value), h('span', {}, label));
  return h('div', {},
    h('div', { class: 'stats' },
      stat(stats.bookings, 'Bookings'), stat(stats.travellers, 'Travellers'),
      stat(rupees(stats.grossSales), 'Gross sales'),
      stat(rupees(stats.payout), `Your payout after ${stats.commissionPercent}% commission`)),
    h('div', { class: 'card' },
      h('h2', {}, 'Next departures'),
      nextDepartures.length
        ? table(['Booking', 'Circuit', 'Date', 'Travellers'], nextDepartures.map((d) => [h('span', { class: 'code' }, d.booking), d.circuit, fmtDate(d.date), d.travellers]))
        : h('p', { class: 'muted' }, 'No upcoming departures yet.')));
}

async function packages(q) {
  const { packages: list } = await api.get(`/owner/packages${q}`);
  const rows = list.map((p) => {
    const price = h('input', { type: 'number', min: 100, max: 200000, step: 1, value: p.price, 'aria-label': `Price for ${p.name}`, class: 'input--price' });
    const save = h('button', { class: 'btn btn--sm', type: 'button' }, 'Save price');
    save.addEventListener('click', async () => {
      setBusy(save, true, 'Saving…');
      try { await api.patch(`/owner/packages/${p.id}`, { price: Number(price.value) }); toast(`${p.name} is now ${rupees(price.value)}`, 'ok'); }
      catch (e) { toast(e.message, 'error'); } finally { setBusy(save, false); }
    });
    const listed = h('input', { type: 'checkbox', checked: p.listed, role: 'switch', 'aria-label': `${p.name} is listed` });
    listed.addEventListener('change', async () => {
      try {
        await api.patch(`/owner/packages/${p.id}`, { listed: listed.checked });
        toast(`${p.name} ${listed.checked ? 'is now listed' : 'is hidden from customers'}`, 'ok');
      } catch (e) { listed.checked = !listed.checked; toast(e.message, 'error'); }
    });
    return [h('span', { class: `dot ${typeClass(p.type)}` }, p.type), p.name, p.days, h('div', { class: 'row' }, price, save), h('label', { class: 'switch' }, listed, h('span', {}, 'Listed'))];
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Packages'), h('p', { class: 'muted' }, 'Change a price or switch a package off to hide it from customers. Existing bookings are not affected.'),
    table(['Type', 'Circuit', 'Days', 'Price (₹)', 'Visibility'], rows));
}

async function bookings(q) {
  const { bookings: list } = await api.get(`/owner/bookings${q}`);
  return h('div', { class: 'card' }, h('h2', {}, 'Bookings'),
    list.length
      ? table(['Booking', 'Circuit', 'Traveller', 'Date', 'People', 'Amount', 'Status'],
        list.map((b) => [h('span', { class: 'code' }, b.code), b.circuit, `${b.traveller} · ${b.mobile}`, fmtDate(b.travelDate), b.travellers, rupees(b.amount),
          h('span', { class: `status ${b.status === 'checked_in' ? 'status--done' : ''}` }, b.status === 'checked_in' ? 'Checked in' : 'Confirmed')]))
      : h('p', { class: 'muted' }, 'No bookings yet.'));
}

function checkin() {
  const out = h('p', { role: 'status', 'aria-live': 'polite', class: 'result' });
  const input = h('input', { type: 'text', placeholder: 'KLB9FV41', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Check in traveller');
  const video = h('video', { class: 'scanner is-hidden', playsinline: true, muted: true });
  let stream = null;
  let scanning = false;

  async function submit(value) {
    out.className = 'result';
    out.textContent = '';
    setBusy(btn, true, 'Checking…');
    try {
      const res = await api.post('/owner/checkin', { input: value });
      out.className = 'result result--ok';
      out.textContent = res.message;
      input.value = '';
    } catch (e) {
      out.className = 'result result--bad';
      out.textContent = e.message;
    } finally { setBusy(btn, false); }
  }

  function stopScan() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.classList.add('is-hidden');
  }

  const scanBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Scan QR with camera');
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    scanBtn.disabled = true;
    scanBtn.title = 'Camera scanning is not supported in this browser. Type the booking ID instead.';
  }
  scanBtn.addEventListener('click', async () => {
    if (scanning) { stopScan(); scanBtn.textContent = 'Scan QR with camera'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch { out.className = 'result result--bad'; out.textContent = 'Camera permission was denied. Type the booking ID instead.'; return; }
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    video.srcObject = stream; video.classList.remove('is-hidden'); await video.play();
    scanning = true; scanBtn.textContent = 'Stop camera';
    const tick = async () => {
      if (!scanning) return;
      try {
        const [hit] = await detector.detect(video);
        if (hit) { stopScan(); scanBtn.textContent = 'Scan QR with camera'; await submit(hit.rawValue); return; }
      } catch { /* keep scanning */ }
      setTimeout(tick, 300);
    };
    tick();
  });
  window.addEventListener('hashchange', stopScan, { once: true });

  return h('div', { class: 'card narrow-card' },
    h('h2', {}, 'Scan or enter a booking ID'),
    h('p', { class: 'muted' }, "Point a scanner at the traveller's QR, or type the ID printed under it. You can only check in tickets for your own circuits."),
    h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(input.value); } },
      field('Booking ID', input), h('div', { class: 'row' }, btn, scanBtn), video, out));
}

function table(head, rows) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((cell, i) => h('td', { 'data-label': head[i] }, cell)))))));
}
