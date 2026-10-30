'use strict';
const express = require('express');
const config = require('../config');
const { transaction } = require('../db');
const { wrap, bad, notFound, forbidden } = require('../lib/http');
const v = require('../lib/validate');
const { requireAuth, requireRole } = require('../lib/auth');
const { convenienceFee } = require('../lib/money');
const { newCode, toDataUrl } = require('../lib/qr');
const payment = require('../lib/payment');

module.exports = (db) => {
  const r = express.Router();
  const guard = [requireAuth(db), requireRole('customer')];

  function loadOrder(id, userId) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
    if (!order) throw notFound('Order not found');
    if (order.user_id !== userId) throw forbidden();
    return order;
  }

  const orderItems = (orderId) =>
    db.prepare(`
      SELECT i.circuit_id AS circuitId, c.name, c.type, i.unit_price AS unitPrice, i.amount
      FROM order_items i JOIN circuits c ON c.id = i.circuit_id
      WHERE i.order_id = ? ORDER BY i.id`).all(orderId);

  const presentOrder = (o) => ({
    id: o.id,
    status: o.status,
    travellerName: o.traveller_name,
    mobile: o.mobile,
    email: o.email,
    travelDate: o.travel_date,
    travellers: o.travellers,
    subtotal: o.subtotal,
    fee: o.fee,
    total: o.total,
    method: o.method,
    items: orderItems(o.id),
  });

  async function presentBookings(rows) {
    return Promise.all(rows.map(async (b) => ({
      code: b.code,
      status: b.status,
      travelDate: b.travel_date,
      travellers: b.travellers,
      amount: b.amount,
      createdAt: b.created_at,
      circuit: { id: b.circuit_id, name: b.circuit_name, type: b.type, days: b.days },
      operator: b.operator_name,
      qr: await toDataUrl(b.code),
    })));
  }

  const bookingSelect = `
    SELECT b.*, c.name AS circuit_name, c.type, c.days, o.name AS operator_name
    FROM bookings b
    JOIN circuits c ON c.id = b.circuit_id
    JOIN operators o ON o.id = c.operator_id`;

  /** Step 1: traveller details + chosen circuits -> priced order (server computes every amount). */
  r.post('/orders', guard, wrap((req, res) => {
    const ids = Array.isArray(req.body.circuitIds) ? [...new Set(req.body.circuitIds.map(Number))] : [];
    if (!ids.length) throw bad('Add at least one circuit to your trip');
    if (ids.length > config.maxCircuitsPerOrder) throw bad(`You can book up to ${config.maxCircuitsPerOrder} circuits at once`);

    const travellerName = v.name(req.body.travellerName, 'Full name');
    const mobile = v.mobile(req.body.mobile);
    const email = v.email(req.body.email, { optional: true });
    const travelDate = v.travelDate(req.body.travelDate);
    const travellers = v.int(req.body.travellers, 'Travellers', { min: 1, max: config.maxTravellers });

    const placeholders = ids.map(() => '?').join(',');
    const circuits = db.prepare(`
      SELECT c.* FROM circuits c JOIN operators o ON o.id = c.operator_id
      WHERE c.listed = 1 AND o.approved = 1 AND c.id IN (${placeholders})`).all(...ids);
    if (circuits.length !== ids.length) throw bad('One of the circuits is no longer available. Refresh and try again.');

    const lines = ids.map((id) => {
      const c = circuits.find((x) => x.id === id);
      return { circuit: c, amount: c.price * travellers };
    });
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const fee = convenienceFee(subtotal);

    const order = transaction(db, () => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO orders (user_id, traveller_name, mobile, email, travel_date, travellers, subtotal, fee, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, travellerName, mobile, email, travelDate, travellers, subtotal, fee, subtotal + fee);
      const ins = db.prepare('INSERT INTO order_items (order_id, circuit_id, unit_price, amount) VALUES (?, ?, ?, ?)');
      for (const l of lines) ins.run(lastInsertRowid, l.circuit.id, l.circuit.price, l.amount);
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(lastInsertRowid);
    });

    const { gatewayOrderId } = payment.provider.createOrder(order);
    db.prepare('UPDATE orders SET gateway_ref = ? WHERE id = ?').run(gatewayOrderId, order.id);
    res.status(201).json({ order: presentOrder(order), paymentMode: config.paymentMode, banks: payment.BANKS });
  }));

  r.get('/orders/:id', guard, wrap((req, res) => {
    res.json({ order: presentOrder(loadOrder(req.params.id, req.user.id)) });
  }));

  /** Step 2: pay. On success one booking (own ID + QR) is issued per circuit. */
  r.post('/orders/:id/pay', guard, wrap(async (req, res) => {
    const order = loadOrder(req.params.id, req.user.id);

    if (order.status === 'paid') {
      // Idempotent: a repeated request returns the same tickets instead of double booking.
      const rows = db.prepare(`${bookingSelect} WHERE b.order_id = ? ORDER BY b.id`).all(order.id);
      return res.json({ order: presentOrder(order), bookings: await presentBookings(rows) });
    }

    const result = payment.provider.charge(order, req.body.payment);
    if (!result.ok) return res.status(402).json({ error: result.message });

    transaction(db, () => {
      // Re-check inside the transaction so two simultaneous requests cannot both issue tickets.
      const fresh = db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id);
      if (fresh.status === 'paid') return;
      db.prepare("UPDATE orders SET status = 'paid', method = ?, gateway_ref = ? WHERE id = ?")
        .run(req.body.payment.method, result.reference, order.id);
      const insert = db.prepare(`
        INSERT INTO bookings (order_id, circuit_id, user_id, code, travellers, travel_date, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const item of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id)) {
        let done = false;
        for (let tries = 0; !done && tries < 5; tries++) {
          try {
            insert.run(order.id, item.circuit_id, order.user_id, newCode(), order.travellers, order.travel_date, item.amount);
            done = true;
          } catch (e) {
            if (!/UNIQUE/.test(e.message)) throw e; // code collision: retry with a new code
          }
        }
        if (!done) throw new Error('Could not allocate a booking code');
      }
    });

    const paid = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    const rows = db.prepare(`${bookingSelect} WHERE b.order_id = ? ORDER BY b.id`).all(order.id);
    res.json({ order: presentOrder(paid), bookings: await presentBookings(rows), message: result.message });
  }));

  r.get('/bookings', guard, wrap(async (req, res) => {
    const rows = db.prepare(`${bookingSelect} WHERE b.user_id = ? ORDER BY b.id DESC`).all(req.user.id);
    res.json({ bookings: await presentBookings(rows) });
  }));

  r.get('/bookings/:code', guard, wrap(async (req, res) => {
    const row = db.prepare(`${bookingSelect} WHERE b.code = ? AND b.user_id = ?`).get(String(req.params.code).toUpperCase(), req.user.id);
    if (!row) throw notFound('Booking not found');
    res.json({ booking: (await presentBookings([row]))[0] });
  }));

  return r;
};
