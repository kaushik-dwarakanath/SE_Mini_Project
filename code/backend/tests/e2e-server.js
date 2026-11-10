// Dedicated ephemeral database; never reads .env or the user's database URI.
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApplication } = require('../app');
const User = require('../models/User');
const Message = require('../models/Message');
const Session = require('../models/Session');

(async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'simplechat_browser_tests' });
    await Promise.all([User.init(), Message.init(), Session.init()]);
    const runtime = createApplication({ secret: randomBytes(48).toString('hex'), dataKey: randomBytes(32).toString('hex'), authLimit: 10000 });
    runtime.server.listen(5001, '127.0.0.1', () => console.log('Browser test backend ready on 5001'));
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        runtime.io.close(async () => { await mongoose.disconnect(); await mongo.stop(); process.exit(0); });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
})().catch((error) => { console.error(error.name, error.message); process.exit(1); });
