#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const logger = require('../utils/logger');

// Import các cron jobs (đây là instances, không phải classes)
const fetchTrackingCron = require('../jobs/fetch-tracking.cron');
const updateStatusJob = require('../jobs/update-status.cron');
const syncOmsOrdersCron = require('../jobs/sync-oms-orders.cron');

// Map các job có sẵn
const jobs = {
    'update-status': updateStatusJob,
    'tracking': fetchTrackingCron,
    'oms-sync': syncOmsOrdersCron,
};

async function runCron() {
    const jobName = process.argv[2];
    
    if (!jobName) {
        console.log('Usage: npm run cron <job-name>');
        console.log('\nAvailable jobs:');
        Object.keys(jobs).forEach(name => {
            console.log(`  - ${name}`);
        });
        process.exit(1);
    }

    const job = jobs[jobName];
    
    if (!job) {
        console.error(`❌ Job "${jobName}" not found!`);
        console.log('\nAvailable jobs:');
        Object.keys(jobs).forEach(name => {
            console.log(`  - ${name}`);
        });
        process.exit(1);
    }

    try {
        logger.info(`🚀 Starting cron job: ${jobName}`);
        console.log(`🚀 Starting cron job: ${jobName}\n`);
        
        // Gọi method run() trực tiếp trên instance
        await job.run();
        
        logger.info(`✅ Cron job completed: ${jobName}`);
        console.log(`\n✅ Cron job completed: ${jobName}`);
        process.exit(0);
        
    } catch (error) {
        logger.error(`❌ Cron job failed: ${jobName}`, error);
        console.error(`\n❌ Cron job failed: ${jobName}`);
        console.error(error);
        process.exit(1);
    }
}

runCron();