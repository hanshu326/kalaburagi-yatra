'use strict';
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function newCode() {
  let s = 'KLB';
  const bytes = crypto.randomBytes(5);
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

const sign = (code) =>
  crypto.createHmac('sha256', config.qrSecret).update(code).digest('base64url').slice(0, 12);

/** Signed payload stored in the QR: tampering with the code invalidates it. */
const makeToken = (code) => `KY1.${code}.${sign(code)}`;

/** Accepts a plain booking ID or a signed QR token; returns the booking code or null. */
function parseInput(input) {
  const s = String(input || '').trim().toUpperCase();
  if (/^KLB[A-Z0-9]{5}$/.test(s)) return s;
  const raw = String(input || '').trim();
  const m = /^KY1\.(KLB[A-Z0-9]{5})\.([A-Za-z0-9_-]{12})$/.exec(raw);
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return m[1];
}

const toDataUrl = (code) =>
  QRCode.toDataURL(makeToken(code), { margin: 1, width: 320, errorCorrectionLevel: 'M' });

module.exports = { newCode, makeToken, parseInput, toDataUrl };
