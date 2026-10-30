'use strict';
const express = require('express');
const { wrap, notFound } = require('../lib/http');

const TYPES = ['Heritage', 'Spiritual', 'Nature', 'Youth'];

const present = (c) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  days: c.days,
  price: c.price,
  stops: c.stops,
  operator: c.operator_name,
});

module.exports = (db) => {
  const r = express.Router();
  const base = `
    SELECT c.*, o.name AS operator_name
    FROM circuits c JOIN operators o ON o.id = c.operator_id
    WHERE c.listed = 1 AND o.approved = 1`;

  r.get('/', wrap((req, res) => {
    const type = TYPES.find((t) => t.toLowerCase() === String(req.query.type || '').toLowerCase());
    const rows = type
      ? db.prepare(`${base} AND c.type = ? ORDER BY c.id`).all(type)
      : db.prepare(`${base} ORDER BY c.id`).all();
    res.json({ circuits: rows.map(present), types: TYPES });
  }));

  r.get('/:id', wrap((req, res) => {
    const row = db.prepare(`${base} AND c.id = ?`).get(Number(req.params.id));
    if (!row) throw notFound('Circuit not found');
    res.json({ circuit: present(row) });
  }));

  return r;
};
