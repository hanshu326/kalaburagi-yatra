'use strict';
const config = require('./config');
const { open } = require('./db');
const { createApp } = require('./app');
const { seedIfEmpty } = require('./seed');

const db = open();
seedIfEmpty(db);
const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`Kalaburagi Yatra running at http://localhost:${config.port} (payments: ${config.paymentMode})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
