'use strict';
const bcrypt = require('bcryptjs');
const { transaction } = require('./db');
const { newCode } = require('./lib/qr');

const DEMO_PASSWORD = 'Demo@1234';

// Circuits from the design deck. Youth circuit names/prices are placeholders: the deck shows no Youth card.
const OPERATORS = [
  {
    name: 'Deccan Trails',
    circuits: [
      ['Heritage Circuit 1', 'Heritage', 1, 1499, 'Fort, Museum, Haft Gumbaz, Sher Gumbaz, Super Market food trail'],
      ['Heritage Circuit 2', 'Heritage', 1, 1799, 'Firozabad, Malkhed, Kalagori ruins, Super Market food trail'],
      ['Spiritual Circuit 1', 'Spiritual', 1, 1299, 'Bande Nawaz Dargah, Sharana Basaveshwara, Ganagapura, Gattaragi Temple'],
      ['Spiritual Circuit 2', 'Spiritual', 1, 1599, 'Koranti Hanuman, Mothakapalli, Mannur, Ladle Mashak Dargah'],
    ],
  },
  {
    name: 'Chincholi Outdoors',
    circuits: [
      ['Nature Circuit 1', 'Nature', 2, 3499, 'Chandrampalli, Ethipota Falls, overnight camp, Gothamgetta trail'],
      ['Nature Circuit 2', 'Nature', 1, 1199, 'Appa Lake, Science Center, Amarja Reservoir'],
      ['Youth Circuit 1', 'Youth', 1, 1399, 'Fort cycling loop, street food crawl, sunset at Appa Lake'],
      ['Youth Circuit 2', 'Youth', 2, 2299, 'Chandrampalli trek, bonfire camp, Ethipota Falls swim spot'],
    ],
  },
];

function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  transaction(db, () => {
    const user = db.prepare('INSERT INTO users (name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, ?)');
    const customerId = user.run('Demo Traveller', 'customer@demo.in', '9876543210', hash, 'customer').lastInsertRowid;
    const ownerId = user.run('Demo Owner', 'owner@demo.in', '9876500001', hash, 'owner').lastInsertRowid;

    const addOp = db.prepare('INSERT INTO operators (owner_id, name) VALUES (?, ?)');
    const addCircuit = db.prepare('INSERT INTO circuits (operator_id, name, type, days, price, stops) VALUES (?, ?, ?, ?, ?, ?)');
    const circuitIds = {};
    for (const op of OPERATORS) {
      const opId = addOp.run(ownerId, op.name).lastInsertRowid;
      for (const c of op.circuits) circuitIds[c[0]] = addCircuit.run(opId, ...c).lastInsertRowid;
    }

    // A few paid bookings so the owner dashboard has data on first run.
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const samples = [
      ['Nature Circuit 1', 2, 3],
      ['Youth Circuit 1', 3, 9],
      ['Heritage Circuit 1', 2, 3],
      ['Spiritual Circuit 2', 4, 6],
    ];
    for (const [name, travellers, inDays] of samples) {
      const price = db.prepare('SELECT price FROM circuits WHERE id = ?').get(circuitIds[name]).price;
      const amount = price * travellers;
      const fee = Math.round(amount * 0.02);
      const orderId = db.prepare(`
        INSERT INTO orders (user_id, traveller_name, mobile, travel_date, travellers, subtotal, fee, total, status, method, gateway_ref)
        VALUES (?, 'Demo Traveller', '9876543210', ?, ?, ?, ?, ?, 'paid', 'upi', 'seed')`)
        .run(customerId, day(inDays), travellers, amount, fee, amount + fee).lastInsertRowid;
      db.prepare('INSERT INTO order_items (order_id, circuit_id, unit_price, amount) VALUES (?, ?, ?, ?)')
        .run(orderId, circuitIds[name], price, amount);
      db.prepare(`
        INSERT INTO bookings (order_id, circuit_id, user_id, code, travellers, travel_date, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(orderId, circuitIds[name], customerId, newCode(), travellers, day(inDays), amount);
    }
  });
  return true;
}

module.exports = { seedIfEmpty, DEMO_PASSWORD };

if (require.main === module) {
  const { open } = require('./db');
  const db = open();
  console.log(seedIfEmpty(db) ? 'Seeded demo data.' : 'Database already has data; nothing to do.');
  console.log('Demo logins: customer@demo.in / owner@demo.in, password', DEMO_PASSWORD);
}
