'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { unauthorized, forbidden } = require('./http');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtTtl });
}

function readToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Attaches req.user ({ id, role, name, email }) or throws 401. */
function requireAuth(db) {
  return (req, _res, next) => {
    const token = readToken(req);
    if (!token) return next(unauthorized());
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT id, name, email, mobile, role FROM users WHERE id = ?').get(payload.sub);
      if (!user) return next(unauthorized('Account no longer exists'));
      req.user = user;
      next();
    } catch {
      next(unauthorized('Your session has expired. Please sign in again.'));
    }
  };
}

const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

module.exports = { signToken, requireAuth, requireRole };
