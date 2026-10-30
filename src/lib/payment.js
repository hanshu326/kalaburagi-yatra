'use strict';
/**
 * Payment gateway abstraction.
 *
 * Phase 1 ships a DEMO provider: it validates the payment details the way a real
 * gateway form would, then "succeeds" without moving money. Phase 2 swaps this for
 * Razorpay / PayU / Cashfree behind the same two-method interface:
 *   createOrder(order)        -> { gatewayOrderId }
 *   charge(order, payment)    -> { ok, reference, message }
 */
const crypto = require('crypto');
const { bad } = require('./http');

const METHODS = ['upi', 'card', 'netbanking'];
const BANKS = ['SBI', 'HDFC', 'ICICI', 'Axis', 'Canara', 'Karnataka Bank'];

function luhn(num) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validatePayment(p) {
  if (!p || !METHODS.includes(p.method)) throw bad('Choose UPI, card or net banking');
  if (p.method === 'upi') {
    if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(String(p.upiId || '').trim())) throw bad('Enter a valid UPI ID, like name@upi');
  }
  if (p.method === 'card') {
    const num = String(p.cardNumber || '').replace(/\s/g, '');
    if (!/^\d{13,19}$/.test(num) || !luhn(num)) throw bad('Enter a valid card number');
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(p.expiry || ''))) throw bad('Enter card expiry as MM/YY');
    if (!/^\d{3,4}$/.test(String(p.cvv || ''))) throw bad('Enter a valid CVV');
  }
  if (p.method === 'netbanking') {
    if (!BANKS.includes(p.bank)) throw bad('Choose your bank');
  }
}

const demoProvider = {
  name: 'demo',
  createOrder(order) {
    return { gatewayOrderId: `demo_order_${order.id}_${crypto.randomBytes(4).toString('hex')}` };
  },
  charge(order, payment) {
    validatePayment(payment);
    // A card ending in 0002 simulates a bank decline so the failure path can be tried.
    if (payment.method === 'card' && String(payment.cardNumber).replace(/\s/g, '').endsWith('0002')) {
      return { ok: false, reference: null, message: 'Your bank declined this payment. Try another method.' };
    }
    return { ok: true, reference: `demo_pay_${crypto.randomBytes(6).toString('hex')}`, message: 'Demo payment: no money charged' };
  },
};

module.exports = { provider: demoProvider, METHODS, BANKS, validatePayment };
