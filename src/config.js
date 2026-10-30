'use strict';
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

function secret(name, devValue) {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return devValue;
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'yatra.db'),
  jwtSecret: secret('JWT_SECRET', 'dev-only-jwt-secret-change-me'),
  qrSecret: secret('QR_SECRET', 'dev-only-qr-secret-change-me'),
  jwtTtl: '12h',
  // Business rules (from the design: 2% convenience fee, 10% operator commission)
  feeRate: 0.02,
  commissionRate: 0.1,
  maxCircuitsPerOrder: 8,
  maxTravellers: 10,
  // Demo mode: no real money moves. Real gateway comes in a later phase.
  paymentMode: process.env.PAYMENT_MODE || 'demo',
  // If true, a booking can only be checked in on its travel date.
  strictCheckinDate: process.env.STRICT_CHECKIN_DATE === 'true',
};
