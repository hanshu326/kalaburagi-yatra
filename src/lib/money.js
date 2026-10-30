'use strict';
const config = require('../config');

/** All amounts are whole rupees. Fee and commission round to the nearest rupee. */
const convenienceFee = (subtotal) => Math.round(subtotal * config.feeRate);
const operatorPayout = (gross) => Math.round(gross * (1 - config.commissionRate));

module.exports = { convenienceFee, operatorPayout };
