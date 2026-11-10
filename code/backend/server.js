require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
const mongoose = require('mongoose');
const { createApplication } = require('./app');
const { migrateEmails } = require('./lib/privacy');
const User = require('./models/User');
const Message = require('./models/Message');
const Session = require('./models/Session');

async function startServer() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN?.startsWith('https://')) {
        throw new Error('Production requires an HTTPS PUBLIC_ORIGIN');
    }
    const runtime = createApplication({
        secret: process.env.JWT_SECRET,
        dataKey: process.env.DATA_ENCRYPTION_KEY,
        publicOrigin: process.env.PUBLIC_ORIGIN || undefined,
        trustProxy: process.env.TRUST_PROXY === '1' ? 1 : false,
    });
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await Promise.all([User.init(), Message.init(), Session.init()]);
    await migrateEmails(runtime.privacy);
    const port = Number(process.env.PORT || 5000);
    const host = process.env.HOST || '127.0.0.1';
    await new Promise((resolve, reject) => {
        runtime.server.once('error', reject);
        runtime.server.listen(port, host, resolve);
    });
    console.log(`SimpleChat listening on port ${port}`);
    const shutdown = () => {
        runtime.io.close(async () => { await mongoose.disconnect(); process.exit(0); });
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return runtime;
}
if (require.main === module) {
    startServer().catch((error) => {
        // Configuration messages are safe; driver errors may include credentials.
        console.error('Startup failed:', error.name === 'Error' ? error.message : error.name);
        process.exit(1);
    });
}
module.exports = { startServer };
