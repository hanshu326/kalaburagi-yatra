'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { seedIfEmpty, DEMO_PASSWORD } = require('../src/seed');
const { makeToken, parseInput } = require('../src/lib/qr');

let server, base, db;

before(async () => {
  db = open(':memory:');
  seedIfEmpty(db);
  server = createApp(db, { rateLimit: false }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); db.close(); });

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } })).body.token;
const futureDate = () => new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const traveller = (extra = {}) => ({ travellerName: 'Asha Rao', mobile: '9876543210', travelDate: futureDate(), travellers: 2, ...extra });
const upi = { payment: { method: 'upi', upiId: 'asha@upi' } };

test('circuits: lists 8 and filters by type', async () => {
  const all = await call('GET', '/circuits');
  assert.equal(all.body.circuits.length, 8);
  const nature = await call('GET', '/circuits?type=nature');
  assert.ok(nature.body.circuits.every((c) => c.type === 'Nature'));
});

test('auth: register, duplicate email, bad login, role guard', async () => {
  const reg = await call('POST', '/auth/register', { body: { name: 'New User', email: 'new@x.in', mobile: '9000000001', password: 'longenough1' } });
  assert.equal(reg.status, 201);
  assert.equal((await call('POST', '/auth/register', { body: { name: 'New User', email: 'NEW@x.in', mobile: '9000000001', password: 'longenough1' } })).status, 409);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'new@x.in', password: 'wrongpass' } })).status, 401);
  assert.equal((await call('GET', '/owner/overview', { token: reg.body.token })).status, 403);
  assert.equal((await call('GET', '/bookings')).status, 401);
});

test('order: server computes totals (ignores client prices) and 2% fee matches the design', async () => {
  const token = await login('customer@demo.in');
  // Design deck example: Heritage 1 + Spiritual 1 + Nature 1, 2 travellers: 2998 + 2598 + 6998 = 12594, fee 252, total 12846
  const res = await call('POST', '/orders', { token, body: { ...traveller(), circuitIds: [1, 3, 5], price: 1 } });
  assert.equal(res.status, 201);
  assert.equal(res.body.order.subtotal, 12594);
  assert.equal(res.body.order.fee, 252);
  assert.equal(res.body.order.total, 12846);
});

test('order: validation errors', async () => {
  const token = await login('customer@demo.in');
  assert.equal((await call('POST', '/orders', { token, body: { ...traveller(), circuitIds: [] } })).status, 400);
  assert.equal((await call('POST', '/orders', { token, body: { ...traveller({ mobile: '123' }), circuitIds: [1] } })).status, 400);
  assert.equal((await call('POST', '/orders', { token, body: { ...traveller({ travelDate: '2020-01-01' }), circuitIds: [1] } })).status, 400);
  assert.equal((await call('POST', '/orders', { token, body: { ...traveller({ travellers: 99 }), circuitIds: [1] } })).status, 400);
  assert.equal((await call('POST', '/orders', { token, body: { ...traveller(), circuitIds: [999] } })).status, 400);
});

test('payment: one booking + QR per circuit, idempotent, decline path', async () => {
  const token = await login('customer@demo.in');
  const { body: { order } } = await call('POST', '/orders', { token, body: { ...traveller(), circuitIds: [1, 2, 5] } });

  const declined = await call('POST', `/orders/${order.id}/pay`, { token, body: { payment: { method: 'card', cardNumber: '4000 0000 0000 0002', expiry: '12/30', cvv: '123' } } });
  assert.equal(declined.status, 402);
  assert.equal((await call('GET', '/bookings', { token })).body.bookings.filter((b) => b.createdAt).length, 4); // only the 4 seeded

  assert.equal((await call('POST', `/orders/${order.id}/pay`, { token, body: { payment: { method: 'upi', upiId: 'bad' } } })).status, 400);

  const paid = await call('POST', `/orders/${order.id}/pay`, { token, body: upi });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.bookings.length, 3);
  assert.equal(new Set(paid.body.bookings.map((b) => b.code)).size, 3);
  assert.ok(paid.body.bookings.every((b) => b.qr.startsWith('data:image/png;base64,') && /^KLB[A-Z0-9]{5}$/.test(b.code)));

  const again = await call('POST', `/orders/${order.id}/pay`, { token, body: upi });
  assert.deepEqual(again.body.bookings.map((b) => b.code), paid.body.bookings.map((b) => b.code));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE order_id = ?').get(order.id).n, 3);
});

test('orders are private to their owner', async () => {
  const a = await login('customer@demo.in');
  const b = (await call('POST', '/auth/register', { body: { name: 'Other Person', email: 'other@x.in', mobile: '9000000002', password: 'longenough1' } })).body.token;
  const { body: { order } } = await call('POST', '/orders', { token: a, body: { ...traveller(), circuitIds: [1] } });
  assert.equal((await call('POST', `/orders/${order.id}/pay`, { token: b, body: upi })).status, 403);
  assert.equal((await call('GET', `/orders/${order.id}`, { token: b })).status, 403);
});

test('owner: overview math, package edits, hiding a circuit', async () => {
  const token = await login('owner@demo.in');
  const ov = (await call('GET', '/owner/overview', { token })).body;
  assert.equal(ov.stats.payout, Math.round(ov.stats.grossSales * 0.9));

  assert.equal((await call('PATCH', '/owner/packages/1', { token, body: { price: 1599 } })).status, 200);
  assert.equal((await call('PATCH', '/owner/packages/1', { token, body: { price: -5 } })).status, 400);
  assert.equal((await call('PATCH', '/owner/packages/2', { token, body: { listed: false } })).status, 200);
  assert.equal((await call('GET', '/circuits')).body.circuits.length, 7);
  await call('PATCH', '/owner/packages/2', { token, body: { listed: true } });
  await call('PATCH', '/owner/packages/1', { token, body: { price: 1499 } });
});

test('owner: cannot touch another owner\'s data', async () => {
  const token = await login('owner@demo.in');
  db.prepare("INSERT INTO users (name, email, mobile, password_hash, role) VALUES ('Rival', 'rival@x.in', '9000000009', 'x', 'owner')").run();
  const rivalId = db.prepare("SELECT id FROM users WHERE email = 'rival@x.in'").get().id;
  const opId = db.prepare('INSERT INTO operators (owner_id, name) VALUES (?, ?)').run(rivalId, 'Rival Tours').lastInsertRowid;
  const cId = db.prepare("INSERT INTO circuits (operator_id, name, type, days, price, stops) VALUES (?, 'Rival Run', 'Youth', 1, 999, 'x')").run(opId).lastInsertRowid;
  assert.equal((await call('PATCH', `/owner/packages/${cId}`, { token, body: { price: 1 } })).status, 403);
  assert.equal((await call('GET', `/owner/overview?operatorId=${opId}`, { token })).status, 403);
});

test('check-in: scoped to own circuits, signed QR, no double check-in', async () => {
  const cust = await login('customer@demo.in');
  const owner = await login('owner@demo.in');
  const { body: { order } } = await call('POST', '/orders', { token: cust, body: { ...traveller(), circuitIds: [5] } });
  const { body: { bookings: [b] } } = await call('POST', `/orders/${order.id}/pay`, { token: cust, body: upi });

  assert.equal((await call('POST', '/owner/checkin', { token: owner, body: { input: 'nonsense' } })).status, 400);
  assert.equal((await call('POST', '/owner/checkin', { token: owner, body: { input: 'KLBZZZZZ' } })).status, 404);
  assert.equal((await call('POST', '/owner/checkin', { token: owner, body: { input: `KY1.${b.code}.AAAAAAAAAAAA` } })).status, 400); // forged signature

  const ok = await call('POST', '/owner/checkin', { token: owner, body: { input: makeToken(b.code) } });
  assert.equal(ok.status, 200);
  assert.match(ok.body.message, /Checked in: Asha Rao/);
  assert.equal((await call('POST', '/owner/checkin', { token: owner, body: { input: b.code.toLowerCase() } })).status, 409);

  // another operator's ticket
  db.prepare("INSERT INTO users (name, email, mobile, password_hash, role) VALUES ('Other Owner', 'o2@x.in', '9000000008', 'x', 'owner')").run();
  const o2 = db.prepare("SELECT id FROM users WHERE email = 'o2@x.in'").get().id;
  db.prepare('INSERT INTO operators (owner_id, name) VALUES (?, ?)').run(o2, 'Second Tours');
  const { signToken } = require('../src/lib/auth');
  const t2 = signToken({ id: o2, role: 'owner' });
  const { body: { order: ord2 } } = await call('POST', '/orders', { token: cust, body: { ...traveller(), circuitIds: [1] } });
  const { body: { bookings: [b2] } } = await call('POST', `/orders/${ord2.id}/pay`, { token: cust, body: upi });
  assert.equal((await call('POST', '/owner/checkin', { token: t2, body: { input: b2.code } })).status, 403);
});

test('qr: tokens verify and tampering is rejected', () => {
  const t = makeToken('KLB23456');
  assert.equal(parseInput(t), 'KLB23456');
  assert.equal(parseInput(t.replace('KLB23456', 'KLB23457')), null);
  assert.equal(parseInput('KLB23456'), 'KLB23456');
  assert.equal(parseInput('<script>'), null);
});
