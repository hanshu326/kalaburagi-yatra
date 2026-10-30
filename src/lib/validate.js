'use strict';
const { bad } = require('./http');

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function name(v, label = 'Name') {
  const s = str(v);
  if (s.length < 2 || s.length > 80) throw bad(`${label} must be 2 to 80 characters`);
  return s;
}

function email(v, { optional = false } = {}) {
  const s = str(v).toLowerCase();
  if (!s && optional) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 120) throw bad('Enter a valid email address');
  return s;
}

function mobile(v) {
  const s = str(v).replace(/[\s-]/g, '').replace(/^\+91/, '');
  if (!/^[6-9]\d{9}$/.test(s)) throw bad('Enter a valid 10 digit Indian mobile number');
  return s;
}

function password(v) {
  if (typeof v !== 'string' || v.length < 8 || v.length > 72) {
    throw bad('Password must be 8 to 72 characters');
  }
  return v;
}

function int(v, label, { min = 1, max = 1_000_000 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number from ${min} to ${max}`);
  return n;
}

function travelDate(v) {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad('Choose a valid travel date');
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  if (s < today) throw bad('Travel date cannot be in the past');
  if (s > limit) throw bad('Travel date must be within the next 12 months');
  return s;
}

module.exports = { str, name, email, mobile, password, int, travelDate };
