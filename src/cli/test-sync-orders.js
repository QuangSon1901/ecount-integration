require('dotenv').config();
const syncOrdersCron = require('../jobs/sync-orders-ecount.cron');

syncOrdersCron.runManually()
    .then(() => {
        console.log('Done');
        process.exit(0);
    })
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });