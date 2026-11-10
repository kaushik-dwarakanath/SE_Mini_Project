const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');

const filename = path.join(__dirname, '../.env');
let content = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
const values = dotenv.parse(content);
for (const name of ['JWT_SECRET', 'DATA_ENCRYPTION_KEY']) {
    if (values[name] && !values[name].startsWith('replace-')) continue;
    const value = randomBytes(name === 'JWT_SECRET' ? 48 : 32).toString('hex');
    const expression = new RegExp('^' + name + '=.*$', 'm');
    content = expression.test(content) ? content.replace(expression, name + '=' + value) : content.trimEnd() + '\n' + name + '=' + value + '\n';
}
fs.writeFileSync(filename, content, { mode: 0o600 });
fs.chmodSync(filename, 0o600);
console.log('Local .env prepared. Existing database settings and configured secrets were preserved. Back up DATA_ENCRYPTION_KEY securely; never commit .env.');
