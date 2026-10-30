'use strict';
const express = require('express');
const config = require('../config');
const { wrap, bad, notFound, forbidden, conflict } = require('../lib/http');
const v = require('../lib/validate');
const { requireAuth, requireRole } = require('../lib/auth');
const { operatorPayout } = require('../lib/money');
const { parseInput } = require('../lib/qr');

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth(db), requireRole('owner'));

  const myOperators = (userId) =>
    db.prepare('SELECT id, name, approved FROM operators WHERE owner_id = ? ORDER BY id').all(userId);

  /** Resolve ?operatorId= to one of the caller's own operators (default: the first). */
  function operatorFor(req) {
    const ops = myOperators(req.user.id);
    if (!ops.length) throw forbidden('No travel business is linked to this account');
    if (req.query.operatorId === undefined) return ops[0];
    const op = ops.find((o) => o.id === Number(req.query.operatorId));
    if (!op) throw forbidden('That travel business is not yours');
    return op;
  }

  r.get('/operators', (req, res) => res.json({ operators: myOperators(req.user.id) }));

  r.get('/overview', wrap((req, res) => {
    const op = operatorFor(req);
    const totals = db.prepare(`
      SELECT COUNT(*) AS bookings, COALESCE(SUM(b.travellers), 0) AS travellers, COALESCE(SUM(b.amount), 0) AS gross
      FROM bookings b JOIN circuits c ON c.id = b.circuit_id WHERE c.operator_id = ?`).get(op.id);
    const today = new Date().toISOString().slice(0, 10);
    const next = db.prepare(`
      SELECT b.code AS booking, c.name AS circuit, b.travel_date AS date, b.travellers
      FROM bookings b JOIN circuits c ON c.id = b.circuit_id
      WHERE c.operator_id = ? AND b.status = 'confirmed' AND b.travel_date >= ?
      ORDER BY b.travel_date, b.id LIMIT 8`).all(op.id, today);
    res.json({
      operator: op,
      stats: {
        bookings: totals.bookings,
        travellers: totals.travellers,
        grossSales: totals.gross,
        payout: operatorPayout(totals.gross),
        commissionPercent: Math.round(config.commissionRate * 100),
      },
      nextDepartures: next,
    });
  }));

  r.get('/packages', wrap((req, res) => {
    const op = operatorFor(req);
    const rows = db.prepare('SELECT id, name, type, days, price, stops, listed FROM circuits WHERE operator_id = ? ORDER BY id').all(op.id);
    res.json({ operator: op, packages: rows.map((c) => ({ ...c, listed: !!c.listed })) });
  }));

  r.patch('/packages/:id', wrap((req, res) => {
    const circuit = db.prepare(`
      SELECT c.*, o.owner_id FROM circuits c JOIN operators o ON o.id = c.operator_id WHERE c.id = ?`).get(Number(req.params.id));
    if (!circuit) throw notFound('Package not found');
    if (circuit.owner_id !== req.user.id) throw forbidden('That package belongs to another operator');

    const hasPrice = req.body.price !== undefined;
    const hasListed = req.body.listed !== undefined;
    if (!hasPrice && !hasListed) throw bad('Nothing to update');
    const price = hasPrice ? v.int(req.body.price, 'Price', { min: 100, max: 200_000 }) : circuit.price;
    if (hasListed && typeof req.body.listed !== 'boolean') throw bad('listed must be true or false');
    const listed = hasListed ? (req.body.listed ? 1 : 0) : circuit.listed;

    db.prepare('UPDATE circuits SET price = ?, listed = ? WHERE id = ?').run(price, listed, circuit.id);
    res.json({ package: { id: circuit.id, name: circuit.name, price, listed: !!listed } });
  }));

  r.get('/bookings', wrap((req, res) => {
    const op = operatorFor(req);
    const rows = db.prepare(`
      SELECT b.code, b.status, b.travel_date AS travelDate, b.travellers, b.amount, b.checked_in_at AS checkedInAt,
             c.name AS circuit, c.type, o.traveller_name AS traveller, o.mobile
      FROM bookings b
      JOIN circuits c ON c.id = b.circuit_id
      JOIN orders o ON o.id = b.order_id
      WHERE c.operator_id = ? ORDER BY b.travel_date, b.id`).all(op.id);
    res.json({ operator: op, bookings: rows });
  }));

  /** Check in by typed booking ID or scanned QR token. Operators can only scan their own circuits. */
  r.post('/checkin', wrap((req, res) => {
    const code = parseInput(req.body.input);
    if (!code) throw bad('That is not a valid booking ID or QR code');

    const b = db.prepare(`
      SELECT b.*, c.name AS circuit, op.owner_id, o.traveller_name AS traveller
      FROM bookings b
      JOIN circuits c ON c.id = b.circuit_id
      JOIN operators op ON op.id = c.operator_id
      JOIN orders o ON o.id = b.order_id
      WHERE b.code = ?`).get(code);
    if (!b) throw notFound('No booking found with that ID');
    if (b.owner_id !== req.user.id) throw forbidden('This ticket is for a circuit run by another operator');
    if (config.strictCheckinDate && b.travel_date !== new Date().toISOString().slice(0, 10)) {
      throw conflict(`This ticket is for ${b.travel_date}, not today`);
    }
    if (b.status === 'checked_in') throw conflict(`Already checked in at ${b.checked_in_at} (UTC)`);

    db.prepare("UPDATE bookings SET status = 'checked_in', checked_in_at = datetime('now') WHERE id = ? AND status = 'confirmed'").run(b.id);
    res.json({
      message: `Checked in: ${b.traveller}, ${b.circuit}, ${b.travellers} traveller${b.travellers > 1 ? 's' : ''}.`,
      booking: { code: b.code, circuit: b.circuit, traveller: b.traveller, travellers: b.travellers },
    });
  }));

  return r;
};
