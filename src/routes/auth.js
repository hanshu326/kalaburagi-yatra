'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { wrap, conflict, unauthorized } = require('../lib/http');
const v = require('../lib/validate');
const { signToken, requireAuth } = require('../lib/auth');

// Tiny in-memory limiter for login/register (per IP). Use Redis or similar when scaling out.
function limiter({ windowMs = 15 * 60_000, max = 30 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) hits.set(key, { start: now, n: 1 });
    else if (++rec.n > max) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    next();
  };
}

module.exports = (db, { rateLimit = true } = {}) => {
  const r = express.Router();
  const limit = rateLimit ? limiter() : (_q, _s, n) => n();

  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, mobile: u.mobile, role: u.role });

  r.post('/register', limit, wrap((req, res) => {
    const name = v.name(req.body.name);
    const email = v.email(req.body.email);
    const mobile = v.mobile(req.body.mobile);
    const password = v.password(req.body.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw conflict('An account with this email already exists');
    const hash = bcrypt.hashSync(password, 10);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, 'customer')")
      .run(name, email, mobile, hash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }));

  r.post('/login', limit, wrap((req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user && bcrypt.compareSync(String(req.body.password || ''), user.password_hash);
    if (!ok) throw unauthorized('Email or password is incorrect');
    res.json({ token: signToken(user), user: publicUser(user) });
  }));

  r.get('/me', requireAuth(db), (req, res) => res.json({ user: publicUser(req.user) }));

  return r;
};
