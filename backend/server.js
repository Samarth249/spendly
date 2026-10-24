const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./database');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));
if (!JWT_SECRET) throw new Error('JWT_SECRET must be configured before starting Spendly in production.');
if (Buffer.byteLength(JWT_SECRET, 'utf8') < 32) throw new Error('JWT_SECRET must contain at least 32 bytes.');

function configuredInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

const BCRYPT_ROUNDS = configuredInteger('BCRYPT_ROUNDS', 12, 10, 14);
const AUTH_TOKEN_TTL_SECONDS = configuredInteger('AUTH_TOKEN_TTL_SECONDS', 24 * 60 * 60, 5 * 60, 30 * 24 * 60 * 60);
const AUTH_RATE_LIMIT_WINDOW_MS = configuredInteger('AUTH_RATE_LIMIT_WINDOW_SECONDS', 15 * 60, 60, 60 * 60) * 1000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = configuredInteger('AUTH_RATE_LIMIT_MAX_ATTEMPTS', 10, 3, 50);
const JWT_ISSUER = 'spendly';
const JWT_AUDIENCE = 'spendly-web';
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('base64url'), BCRYPT_ROUNDS);

function configuredCorsOrigins() {
  const origins = new Set();
  const configured = (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of configured) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGINS contains an invalid origin.'); }
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('CORS_ORIGINS entries must be HTTP(S) origins without a path.');
    }
    origins.add(origin);
  }
  if (process.env.NODE_ENV !== 'production') {
    ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5000', 'http://127.0.0.1:5000',
      'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8765', 'http://127.0.0.1:8765']
      .forEach(origin => origins.add(origin));
  }
  return origins;
}

const corsOrigins = configuredCorsOrigins();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' http://localhost:5000 http://127.0.0.1:5000"
  });
  const origin = req.get('origin');
  if (origin && corsOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  } else if (origin && req.method === 'OPTIONS') {
    return res.sendStatus(403);
  }
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Serve only the browser app shell. Do not expose backend source, databases,
// package metadata, or other files from the project directory.
const publicFiles = {
  '/index.html': 'index.html',
  '/login.html': 'login.html',
  '/register.html': 'register.html',
  '/app.js': 'app.js',
  '/theme.js': 'theme.js',
  '/styles.css': 'styles.css',
  '/themes.css': 'themes.css',
  '/sw.js': 'sw.js',
  '/manifest.json': 'manifest.json'
};
app.get('/', (req, res, next) => res.sendFile(path.join(__dirname, '../index.html'), error => error && next(error)));
for (const [route, file] of Object.entries(publicFiles)) {
  app.get(route, (req, res, next) => res.sendFile(path.join(__dirname, '..', file), error => error && next(error)));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fail(status, message) { throw new HttpError(status, message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function positiveId(value, label = 'ID') {
  let id = NaN;
  if (typeof value === 'number') {
    id = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    id = Number(value);
  }
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, `${label} is invalid.`);
  return id;
}

// Parse decimal currency into integer minor units. Inputs with sub-paisa precision are rejected.
function moneyToCents(value, label = 'Amount') {
  if (typeof value !== 'number' && typeof value !== 'string') fail(400, `${label} must be a number.`);
  const raw = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) fail(400, `${label} must be a non-negative amount with at most two decimal places.`);
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents)) fail(400, `${label} is too large.`);
  return cents;
}

function centsToMoney(cents) { return cents / 100; }
function storedMoneyToCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Stored monetary value is invalid.');
  const scaled = numeric * 100;
  const cents = Math.trunc(scaled + 0.5);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 0.000001) throw new Error('Stored monetary value exceeds supported currency precision.');
  return cents;
}
function requirePositiveCents(value, label = 'Amount') {
  const cents = moneyToCents(value, label);
  if (cents <= 0) fail(400, `${label} must be greater than zero.`);
  return cents;
}
function cleanText(value, label, { required = false, max = 120, fallback = '' } = {}) {
  if (value === undefined || value === null) value = fallback;
  if (typeof value !== 'string') fail(400, `${label} must be text.`);
  const result = value.trim();
  if (required && !result) fail(400, `${label} is required.`);
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return result;
}
function isValidEmailAddress(email) {
  let atIndex = -1;
  let hasDomainDot = false;
  for (let index = 0; index < email.length; index += 1) {
    const character = email[index];
    if (character.trim() === '') return false;
    if (character === '@') {
      if (atIndex !== -1) return false;
      atIndex = index;
    } else if (character === '.' && atIndex !== -1 && index > atIndex + 1 && index < email.length - 1) {
      hasDomainDot = true;
    }
  }
  return atIndex > 0 && atIndex < email.length - 1 && hasDomainDot;
}
function validDate(value, label = 'Date') {
  if (typeof value !== 'string' || !value.trim()) fail(400, `${label} is required.`);
  const raw = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    const candidate = new Date(Date.UTC(y, m - 1, d));
    if (candidate.getUTCFullYear() !== y || candidate.getUTCMonth() !== m - 1 || candidate.getUTCDate() !== d) fail(400, `${label} is invalid.`);
    return raw;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) {
    fail(400, `${label} must be a valid ISO date.`);
  }
  return raw;
}
function optionalDate(value, fallback, label) { return value === undefined ? fallback : validDate(value, label); }
function userWalletId(value) { return positiveId(value, 'Wallet'); }
function validatedType(value) {
  if (value !== 'income' && value !== 'expense') fail(400, 'Transaction type must be income or expense.');
  return value;
}
function safeError(error, res, fallback) {
  if (error instanceof HttpError) return res.status(error.status).json({ success: false, error: error.message });
  console.error(fallback);
  return res.status(500).json({ success: false, error: fallback });
}
function endpoint(handler, fallback) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) { safeError(error, res, fallback); }
  };
}

function sessionId() { return crypto.randomBytes(32).toString('base64url'); }
function sessionExpiry() { return Date.now() + AUTH_TOKEN_TTL_SECONDS * 1000; }
function issueToken(userId, currentSessionId) {
  return jwt.sign({ sub: String(userId), sid: currentSessionId }, JWT_SECRET, {
    algorithm: 'HS256',
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
    expiresIn: AUTH_TOKEN_TTL_SECONDS
  });
}
async function createSession(userId) {
  const currentSessionId = sessionId();
  const expiresAt = sessionExpiry();
  await db.transaction(async tx => {
    await tx.run('DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= ?', [userId, Date.now()]);
    await tx.run('INSERT INTO auth_sessions (user_id, session_id, expires_at) VALUES (?, ?, ?)', [userId, currentSessionId, expiresAt]);
  });
  return { token: issueToken(userId, currentSessionId), sessionId: currentSessionId };
}

const authRateLimitEntries = new Map();
function authRateLimitKeys(req, scope) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const suppliedEmail = isObject(req.body) && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return [
    { key: `${scope}:ip:${ip}`, max: AUTH_RATE_LIMIT_MAX_ATTEMPTS * 4 },
    { key: `${scope}:ip-email:${ip}:${suppliedEmail || '-'}`, max: AUTH_RATE_LIMIT_MAX_ATTEMPTS }
  ];
}
function pruneRateLimitEntries(now) {
  for (const [key, entry] of authRateLimitEntries) {
    entry.attempts = entry.attempts.filter(timestamp => now - timestamp < AUTH_RATE_LIMIT_WINDOW_MS);
    if (!entry.attempts.length && entry.blockedUntil <= now) authRateLimitEntries.delete(key);
  }
  while (authRateLimitEntries.size > 5000) authRateLimitEntries.delete(authRateLimitEntries.keys().next().value);
}
function authRateLimit(scope) {
  return (req, res, next) => {
    const now = Date.now();
    pruneRateLimitEntries(now);
    const keys = authRateLimitKeys(req, scope);
    for (const item of keys) {
      const entry = authRateLimitEntries.get(item.key);
      if (entry && entry.blockedUntil > now) {
        const retrySeconds = Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
        res.set('Retry-After', String(retrySeconds));
        return res.status(429).json({ success: false, error: 'Too many sign-in attempts. Please try again later.' });
      }
      if (entry && entry.attempts.length >= item.max) {
        entry.blockedUntil = now + AUTH_RATE_LIMIT_WINDOW_MS;
        authRateLimitEntries.set(item.key, entry);
        res.set('Retry-After', String(Math.ceil(AUTH_RATE_LIMIT_WINDOW_MS / 1000)));
        return res.status(429).json({ success: false, error: 'Too many sign-in attempts. Please try again later.' });
      }
    }
    keys.forEach(item => {
      const entry = authRateLimitEntries.get(item.key) || { attempts: [], blockedUntil: 0 };
      entry.attempts.push(now);
      authRateLimitEntries.set(item.key, entry);
    });
    req.authRateLimitKeys = keys.map(item => item.key);
    next();
  };
}
function clearAuthRateLimit(req) {
  (req.authRateLimitKeys || []).forEach(key => authRateLimitEntries.delete(key));
}

async function authenticateToken(req, res, next) {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ success: false, error: 'Sign in to continue.' });
  try {
    const claims = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'], audience: JWT_AUDIENCE, issuer: JWT_ISSUER });
    const id = positiveId(claims.sub, 'Account');
    if (typeof claims.sid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(claims.sid)) throw new Error('Invalid session claim.');
    const session = await db.get(`SELECT s.user_id FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ? AND s.session_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`, [id, claims.sid, Date.now()]);
    if (!session) return res.status(401).json({ success: false, error: 'Your session is no longer valid. Please sign in again.' });
    req.user = { id: session.user_id };
    req.authSession = { id: claims.sid };
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Your session is expired or invalid. Please sign in again.' });
  }
}

function requireBody(req) {
  if (!isObject(req.body)) fail(400, 'Request body must be a JSON object.');
  return req.body;
}

async function getOwnedWallet(query, walletId, userId) {
  const wallet = await query.get('SELECT * FROM wallets WHERE id = ? AND user_id = ?', [walletId, userId]);
  if (!wallet) fail(404, 'Wallet not found for this account.');
  return wallet;
}

async function applyWalletBalance(query, userId, walletId, cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) fail(400, 'This operation would create a negative wallet balance.');
  const result = await query.run('UPDATE wallets SET balance = ? WHERE id = ? AND user_id = ?', [centsToMoney(cents), walletId, userId]);
  if (!result.changes) fail(404, 'Wallet not found for this account.');
}

function adjustmentFor(type, amountCents) { return type === 'income' ? amountCents : -amountCents; }
function dateOrNow(value, label) { return value === undefined ? new Date().toISOString() : validDate(value, label); }
function importKeyForTransaction(entry) {
  return crypto.createHash('sha256').update(JSON.stringify([
    entry.walletType, entry.type, entry.amount, entry.category, entry.emoji, entry.note, entry.date
  ])).digest('hex');
}
async function findExistingImportedTransaction(tx, userId, entry, walletId, importKey) {
  return tx.get(`SELECT id FROM transactions WHERE user_id = ? AND
    (import_key = ? OR (wallet_id = ? AND type = ? AND amount = ? AND category = ? AND COALESCE(note, '') = ? AND transaction_date = ?)) LIMIT 1`,
  [userId, importKey, walletId, entry.type, centsToMoney(entry.amount), entry.category, entry.note, entry.date]);
}
async function insertImportedTransaction(tx, userId, entry, walletId, importKey) {
  return tx.run(`INSERT INTO transactions
    (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date, import_key, transfer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [userId, walletId, entry.type, centsToMoney(entry.amount), entry.category, entry.emoji, entry.note, entry.date, importKey, entry.transferId]);
}
async function createTransaction(tx, userId, { walletId, type, amount, category, emoji, note, date, idempotencyKey }) {
  if (idempotencyKey) {
    const existing = await tx.get('SELECT * FROM transactions WHERE user_id = ? AND import_key = ?', [userId, idempotencyKey]);
    if (existing) {
      const matches = existing.wallet_id === walletId && existing.type === type &&
        storedMoneyToCents(existing.amount) === amount && existing.category === category &&
        (existing.category_emoji || '') === emoji && (existing.note || '') === note;
      if (!matches) fail(409, 'This payment reference was already used for a different transaction.');
      const transaction = await tx.get(`SELECT t.*, w.name AS wallet_name, w.type AS wallet_type FROM transactions t
        JOIN wallets w ON w.id = t.wallet_id WHERE t.id = ? AND t.user_id = ?`, [existing.id, userId]);
      const wallet = await tx.get('SELECT * FROM wallets WHERE id = ? AND user_id = ?', [existing.wallet_id, userId]);
      return { transaction, wallet, replayed: true };
    }
  }

  const wallet = await getOwnedWallet(tx, walletId, userId);
  const newBalance = storedMoneyToCents(wallet.balance) + adjustmentFor(type, amount);
  await applyWalletBalance(tx, userId, walletId, newBalance);
  const insert = idempotencyKey
    ? await tx.run(`INSERT INTO transactions
        (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date, import_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, walletId, type, centsToMoney(amount), category, emoji, note, date, idempotencyKey])
    : await tx.run(`INSERT INTO transactions
        (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, walletId, type, centsToMoney(amount), category, emoji, note, date]);
  const transaction = await tx.get(`SELECT t.*, w.name AS wallet_name, w.type AS wallet_type FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id WHERE t.id = ? AND t.user_id = ?`, [insert.lastID, userId]);
  const updatedWallet = await tx.get('SELECT * FROM wallets WHERE id = ? AND user_id = ?', [walletId, userId]);
  return { transaction, wallet: updatedWallet, replayed: false };
}

// AUTH
app.post('/api/register', authRateLimit('register'), endpoint(async (req, res) => {
  const body = requireBody(req);
  const name = cleanText(body.name, 'Name', { required: true, max: 80 });
  const email = cleanText(body.email, 'Email', { required: true, max: 254 }).toLowerCase();
  const password = body.password;
  if (!isValidEmailAddress(email)) fail(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) fail(400, 'Password must be at least 8 characters and no longer than 72 UTF-8 bytes.');
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) fail(409, 'Unable to create an account with these details.');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const currentSessionId = sessionId();
  const expiresAt = sessionExpiry();
  const user = await db.transaction(async tx => {
    const result = await tx.run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, passwordHash]);
    await tx.run('INSERT INTO wallets (user_id, name, type, balance, is_default) VALUES (?, ?, ?, ?, ?)', [result.lastID, 'Cash Wallet', 'cash', 0, 1]);
    await tx.run('INSERT INTO wallets (user_id, name, type, balance, is_default) VALUES (?, ?, ?, ?, ?)', [result.lastID, 'Online / Bank', 'online', 0, 0]);
    await tx.run('INSERT INTO auth_sessions (user_id, session_id, expires_at) VALUES (?, ?, ?)', [result.lastID, currentSessionId, expiresAt]);
    return { id: result.lastID, name, email };
  });
  clearAuthRateLimit(req);
  const token = issueToken(user.id, currentSessionId);
  res.status(201).json({ success: true, message: 'Account created successfully.', token, user });
}, 'Unable to create your account.'));

app.post('/api/login', authRateLimit('login'), endpoint(async (req, res) => {
  const body = requireBody(req);
  const email = cleanText(body.email, 'Email', { required: true, max: 254 }).toLowerCase();
  if (typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) {
    fail(401, 'Invalid email or password.');
  }
  const user = await db.get('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
  let passwordMatches = false;
  try {
    passwordMatches = await bcrypt.compare(body.password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
  } catch {
    passwordMatches = false;
  }
  if (!user || !passwordMatches) fail(401, 'Invalid email or password.');
  if (bcrypt.getRounds(user.password_hash) < BCRYPT_ROUNDS) {
    const upgradedHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', [upgradedHash, user.id, user.password_hash]);
  }
  const session = await createSession(user.id);
  clearAuthRateLimit(req);
  res.json({ success: true, message: 'Login successful.', token: session.token, user: { id: user.id, name: user.name, email: user.email } });
}, 'Unable to sign in.'));

app.post('/api/logout', authenticateToken, endpoint(async (req, res) => {
  await db.run('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL',
    [Date.now(), req.user.id, req.authSession.id]);
  res.status(204).end();
}, 'Unable to sign out.'));

app.get('/api/me', authenticateToken, endpoint(async (req, res) => {
  const user = await db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) fail(404, 'Account not found.');
  res.json({ success: true, user });
}, 'Unable to retrieve your profile.'));

// WALLETS
app.get('/api/wallets', authenticateToken, endpoint(async (req, res) => {
  const wallets = await db.all('SELECT * FROM wallets WHERE user_id = ? ORDER BY is_default DESC, id ASC', [req.user.id]);
  res.json({ success: true, wallets });
}, 'Unable to fetch wallets.'));

app.post('/api/wallets/:id/deposit', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const walletId = positiveId(req.params.id, 'Wallet');
  const amount = requirePositiveCents(body.amount);
  const wallet = await db.transaction(async tx => {
    const current = await getOwnedWallet(tx, walletId, req.user.id);
    const balance = storedMoneyToCents(current.balance) + amount;
    await applyWalletBalance(tx, req.user.id, walletId, balance);
    return tx.get('SELECT * FROM wallets WHERE id = ? AND user_id = ?', [walletId, req.user.id]);
  });
  res.json({ success: true, wallet });
}, 'Unable to add funds to that wallet.'));

// TRANSACTIONS
app.get('/api/transactions', authenticateToken, endpoint(async (req, res) => {
  const transactions = await db.all(`SELECT t.*, w.name AS wallet_name, w.type AS wallet_type
    FROM transactions t JOIN wallets w ON w.id = t.wallet_id
    WHERE t.user_id = ? AND w.user_id = ? ORDER BY t.transaction_date DESC, t.id DESC`, [req.user.id, req.user.id]);
  res.json({ success: true, transactions });
}, 'Unable to fetch transactions.'));

app.post('/api/transactions', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const walletId = userWalletId(body.wallet_id);
  let type = 'expense';
  if (body.type !== undefined) type = validatedType(body.type);
  const amount = requirePositiveCents(body.amount);
  const category = cleanText(body.category, 'Category', { required: true, max: 80 });
  const emoji = cleanText(body.category_emoji, 'Category icon', { max: 16, fallback: '\u{1F4B3}' });
  const note = cleanText(body.note, 'Note', { max: 500 });
  const date = dateOrNow(body.transaction_date, 'Transaction date');
  let idempotencyKey = null;
  if (body.idempotency_key !== undefined) {
    idempotencyKey = cleanText(body.idempotency_key, 'Idempotency key', { required: true, max: 120 });
  }
  if (idempotencyKey && !/^[A-Za-z0-9:_-]{1,120}$/.test(idempotencyKey)) fail(400, 'Idempotency key has an invalid format.');

  const result = await db.transaction(tx => createTransaction(tx, req.user.id, {
    walletId, type, amount, category, emoji, note, date, idempotencyKey
  }));
  res.status(result.replayed ? 200 : 201).json({ success: true, transaction: result.transaction, wallet: result.wallet, replayed: result.replayed });
}, 'Unable to record that transaction.'));

app.put('/api/transactions/:id', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const txId = positiveId(req.params.id, 'Transaction');
  const walletId = userWalletId(body.wallet_id);
  const type = validatedType(body.type);
  const amount = requirePositiveCents(body.amount);
  const category = cleanText(body.category, 'Category', { required: true, max: 80 });
  const note = cleanText(body.note, 'Note', { max: 500 });
  const emoji = cleanText(body.category_emoji, 'Category icon', { max: 16, fallback: '💳' });
  const transaction = await db.transaction(async tx => {
    const old = await tx.get('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [txId, req.user.id]);
    if (!old) fail(404, 'Transaction not found.');
    if (isDeferredSettlement(old)) {
      fail(409, 'Settled deferred expense payments cannot be edited.');
    }
    if (old.transfer_id) fail(400, 'Transfers are changed as a pair and cannot be edited as a single transaction.');
    const oldWallet = await getOwnedWallet(tx, old.wallet_id, req.user.id);
    const newWallet = old.wallet_id === walletId ? oldWallet : await getOwnedWallet(tx, walletId, req.user.id);
    const changes = new Map();
    changes.set(oldWallet.id, adjustmentFor(old.type, storedMoneyToCents(old.amount)) * -1);
    changes.set(walletId, (changes.get(walletId) || 0) + adjustmentFor(type, amount));
    for (const [id, delta] of changes) {
      const wallet = id === oldWallet.id ? oldWallet : newWallet;
      await applyWalletBalance(tx, req.user.id, id, storedMoneyToCents(wallet.balance) + delta);
    }
    const date = body.transaction_date === undefined ? old.transaction_date : validDate(body.transaction_date, 'Transaction date');
    await tx.run(`UPDATE transactions SET wallet_id = ?, type = ?, amount = ?, category = ?, category_emoji = ?, note = ?, transaction_date = ?
      WHERE id = ? AND user_id = ?`, [walletId, type, centsToMoney(amount), category, emoji, note, date, txId, req.user.id]);
    return tx.get(`SELECT t.*, w.name AS wallet_name, w.type AS wallet_type FROM transactions t
      JOIN wallets w ON w.id = t.wallet_id WHERE t.id = ? AND t.user_id = ?`, [txId, req.user.id]);
  });
  res.json({ success: true, transaction });
}, 'Unable to update that transaction.'));

function isDeferredSettlement(record) {
  return String(record.import_key || '').startsWith('deferred-settlement:') ||
    String(record.note || '').startsWith('Spendly deferred settlement:');
}
function transferMemo(note) {
  const separator = String(note || '').indexOf(':');
  return separator < 0 ? null : String(note || '').slice(separator + 1).trim();
}
async function findLegacyTransferPair(tx, record, userId) {
  const outgoing = record.category === 'Transfer Out' && record.type === 'expense';
  const incoming = record.category === 'Transfer In' && record.type === 'income';
  if (!outgoing && !incoming) fail(409, 'This older transfer is incomplete and cannot be safely removed.');

  const category = outgoing ? 'Transfer In' : 'Transfer Out';
  const type = outgoing ? 'income' : 'expense';
  const candidates = await tx.all(`SELECT * FROM transactions WHERE user_id = ? AND category = ? AND type = ? AND amount = ? AND transaction_date = ?`,
    [userId, category, type, record.amount, record.transaction_date]);
  const currentWallet = await getOwnedWallet(tx, record.wallet_id, userId);
  const memo = transferMemo(record.note);
  const matching = [];
  for (const candidate of candidates) {
    const otherWallet = await getOwnedWallet(tx, candidate.wallet_id, userId);
    const otherMemo = transferMemo(candidate.note);
    if (otherWallet.id !== currentWallet.id && otherMemo !== null && otherMemo === memo) matching.push(candidate);
  }
  if (matching.length !== 1) fail(409, 'This older transfer has no unique matching side and cannot be safely removed.');
  return [record, matching[0]];
}
function validateTransferPair(pair) {
  const outgoing = pair.find(leg => leg.category === 'Transfer Out' && leg.type === 'expense');
  const incoming = pair.find(leg => leg.category === 'Transfer In' && leg.type === 'income');
  if (pair.length !== 2 || !outgoing || !incoming || outgoing.amount !== incoming.amount ||
      outgoing.wallet_id === incoming.wallet_id || outgoing.transaction_date !== incoming.transaction_date) {
    fail(409, 'This transfer is incomplete and cannot be safely removed.');
  }
}
async function restoreTransferBalances(tx, pair, userId) {
  const changes = new Map();
  for (const leg of pair) {
    const wallet = await getOwnedWallet(tx, leg.wallet_id, userId);
    const restore = -adjustmentFor(leg.type, storedMoneyToCents(leg.amount));
    changes.set(wallet.id, (changes.get(wallet.id) || 0) + restore);
  }
  for (const [walletId, delta] of changes) {
    const wallet = await getOwnedWallet(tx, walletId, userId);
    await applyWalletBalance(tx, userId, walletId, storedMoneyToCents(wallet.balance) + delta);
  }
}
async function deleteTransfer(tx, record, userId) {
  let pair;
  if (record.transfer_id) {
    pair = await tx.all('SELECT * FROM transactions WHERE user_id = ? AND transfer_id = ?', [userId, record.transfer_id]);
  } else {
    pair = await findLegacyTransferPair(tx, record, userId);
  }
  validateTransferPair(pair);
  await restoreTransferBalances(tx, pair, userId);
  const result = record.transfer_id
    ? await tx.run('DELETE FROM transactions WHERE user_id = ? AND transfer_id = ?', [userId, record.transfer_id])
    : await tx.run('DELETE FROM transactions WHERE user_id = ? AND id IN (?, ?)', [userId, pair[0].id, pair[1].id]);
  if (result.changes !== 2) fail(409, 'This transfer changed before it could be removed.');
}
async function deleteTransactionRecord(tx, txId, userId) {
  const record = await tx.get('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [txId, userId]);
  if (!record) fail(404, 'Transaction not found.');
  if (isDeferredSettlement(record)) fail(409, 'Settled deferred expense payments cannot be deleted.');
  if (record.transfer_id || record.category === 'Transfer Out' || record.category === 'Transfer In') {
    await deleteTransfer(tx, record, userId);
    return true;
  }
  const wallet = await getOwnedWallet(tx, record.wallet_id, userId);
  const restore = -adjustmentFor(record.type, storedMoneyToCents(record.amount));
  await applyWalletBalance(tx, userId, wallet.id, storedMoneyToCents(wallet.balance) + restore);
  await tx.run('DELETE FROM transactions WHERE id = ? AND user_id = ?', [txId, userId]);
  return false;
}

app.delete('/api/transactions/:id', authenticateToken, endpoint(async (req, res) => {
  const txId = positiveId(req.params.id, 'Transaction');
  const deletedTransfer = await db.transaction(tx => deleteTransactionRecord(tx, txId, req.user.id));
  res.json({ success: true, message: deletedTransfer ? 'Both sides of the transfer were deleted and balances restored.' : 'Transaction deleted.' });
}, 'Unable to delete that transaction.'));

// KHATA
app.get('/api/khata', authenticateToken, endpoint(async (req, res) => {
  const records = await db.all(`SELECT k.*, w.name AS wallet_name, w.type AS wallet_type
    FROM khata_records k JOIN wallets w ON w.id = k.wallet_id
    WHERE k.user_id = ? AND w.user_id = ? ORDER BY k.lent_date DESC, k.id DESC`, [req.user.id, req.user.id]);
  for (const record of records) {
    record.repayments = await db.all('SELECT * FROM khata_repayments WHERE khata_id = ? AND user_id = ? ORDER BY repayment_date ASC', [record.id, req.user.id]);
    record.outstanding = centsToMoney(storedMoneyToCents(record.original_amount) - storedMoneyToCents(record.amount_repaid));
  }
  res.json({ success: true, records });
}, 'Unable to fetch Khata records.'));

app.post('/api/khata', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const walletId = userWalletId(body.wallet_id);
  const friendName = cleanText(body.friend_name, 'Friend name', { required: true, max: 80 });
  const amount = requirePositiveCents(body.amount);
  const category = cleanText(body.category, 'Category', { required: true, max: 80 });
  const emoji = cleanText(body.category_emoji, 'Category icon', { max: 16, fallback: '🤝' });
  const note = cleanText(body.note, 'Note', { max: 500 });
  const date = dateOrNow(body.lent_date, 'Lent date');
  const record = await db.transaction(async tx => {
    const wallet = await getOwnedWallet(tx, walletId, req.user.id);
    await applyWalletBalance(tx, req.user.id, walletId, storedMoneyToCents(wallet.balance) - amount);
    const result = await tx.run(`INSERT INTO khata_records
      (user_id, wallet_id, friend_name, original_amount, category, category_emoji, note, lent_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [req.user.id, walletId, friendName, centsToMoney(amount), category, emoji, note, date]);
    const created = await tx.get(`SELECT k.*, w.name AS wallet_name, w.type AS wallet_type FROM khata_records k
      JOIN wallets w ON w.id = k.wallet_id WHERE k.id = ? AND k.user_id = ?`, [result.lastID, req.user.id]);
    created.repayments = [];
    created.outstanding = centsToMoney(amount);
    return created;
  });
  res.status(201).json({ success: true, record });
}, 'Unable to create that Khata record.'));

app.post('/api/khata/:id/repay', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const khataId = positiveId(req.params.id, 'Khata record');
  const amount = requirePositiveCents(body.amount, 'Repayment');
  const note = cleanText(body.note, 'Note', { max: 500 });
  const date = dateOrNow(body.repayment_date, 'Repayment date');
  const requestedWalletId = body.wallet_id === undefined ? null : userWalletId(body.wallet_id);
  const record = await db.transaction(async tx => {
    const current = await tx.get('SELECT * FROM khata_records WHERE id = ? AND user_id = ?', [khataId, req.user.id]);
    if (!current) fail(404, 'Khata record not found.');
    const original = storedMoneyToCents(current.original_amount);
    const repaid = storedMoneyToCents(current.amount_repaid);
    const outstanding = original - repaid;
    if (current.status === 'settled' || outstanding <= 0) fail(400, 'This record is already fully settled.');
    if (amount > outstanding) fail(400, `Repayment exceeds the outstanding balance of ₹${centsToMoney(outstanding).toFixed(2)}.`);
    const wallet = await getOwnedWallet(tx, requestedWalletId || current.wallet_id, req.user.id);
    const newRepaid = repaid + amount;
    const remaining = original - newRepaid;
    await tx.run('INSERT INTO khata_repayments (khata_id, user_id, amount, note, repayment_date) VALUES (?, ?, ?, ?, ?)',
      [khataId, req.user.id, centsToMoney(amount), note, date]);
    await tx.run('UPDATE khata_records SET amount_repaid = ?, status = ?, settled_date = ? WHERE id = ? AND user_id = ?',
      [centsToMoney(newRepaid), remaining === 0 ? 'settled' : 'outstanding', remaining === 0 ? date : null, khataId, req.user.id]);
    await applyWalletBalance(tx, req.user.id, wallet.id, storedMoneyToCents(wallet.balance) + amount);
    const updated = await tx.get(`SELECT k.*, w.name AS wallet_name, w.type AS wallet_type FROM khata_records k
      JOIN wallets w ON w.id = k.wallet_id WHERE k.id = ? AND k.user_id = ?`, [khataId, req.user.id]);
    updated.repayments = await tx.all('SELECT * FROM khata_repayments WHERE khata_id = ? AND user_id = ? ORDER BY repayment_date ASC', [khataId, req.user.id]);
    updated.outstanding = centsToMoney(remaining);
    return updated;
  });
  res.json({ success: true, record });
}, 'Unable to record that repayment.'));

app.post('/api/wallets/transfer', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const fromId = userWalletId(body.from_wallet_id);
  const toId = userWalletId(body.to_wallet_id);
  if (fromId === toId) fail(400, 'Choose two different wallets.');
  const amount = requirePositiveCents(body.amount);
  const note = cleanText(body.note, 'Note', { max: 300, fallback: 'Wallet transfer' });
  const wallets = await db.transaction(async tx => {
    const source = await getOwnedWallet(tx, fromId, req.user.id);
    const destination = await getOwnedWallet(tx, toId, req.user.id);
    await applyWalletBalance(tx, req.user.id, fromId, storedMoneyToCents(source.balance) - amount);
    await applyWalletBalance(tx, req.user.id, toId, storedMoneyToCents(destination.balance) + amount);
    const date = new Date().toISOString();
    const transferId = crypto.randomUUID();
    await tx.run(`INSERT INTO transactions (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date, transfer_id)
      VALUES (?, ?, 'expense', ?, 'Transfer Out', '🔄', ?, ?, ?)`, [req.user.id, fromId, centsToMoney(amount), `Transfer to ${destination.name}: ${note}`, date, transferId]);
    await tx.run(`INSERT INTO transactions (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date, transfer_id)
      VALUES (?, ?, 'income', ?, 'Transfer In', '🔄', ?, ?, ?)`, [req.user.id, toId, centsToMoney(amount), `Transfer from ${source.name}: ${note}`, date, transferId]);
    return tx.all('SELECT * FROM wallets WHERE user_id = ? ORDER BY is_default DESC, id ASC', [req.user.id]);
  });
  res.json({ success: true, message: 'Transfer completed successfully.', wallets });
}, 'Unable to complete that transfer.'));

// Validated, additive import. Client IDs and user IDs are never used as database ownership keys.
const IMPORT_FIELDS = new Set(['id', 'wallet_id', 'wallet', 'type', 'amount', 'category', 'category_emoji', 'date', 'transaction_date', 'notes', 'note', 'transfer_id']);
function validateImportedTransaction(item, index) {
  const amount = validateImportedAmount(item, index, 'Transaction', IMPORT_FIELDS);
  const category = cleanText(item.category, `Transaction ${index + 1} category`, { required: true, max: 80 });
  const type = item.type === undefined ? 'expense' : validatedType(item.type);
  const walletType = item.wallet;
  if (walletType !== 'cash' && walletType !== 'online') fail(400, `Transaction ${index + 1} has an invalid wallet reference.`);
  const date = validDate(item.transaction_date === undefined ? item.date : item.transaction_date, `Transaction ${index + 1} date`);
  const note = cleanText(item.note === undefined ? item.notes : item.note, `Transaction ${index + 1} note`, { max: 500 });
  const emoji = cleanText(item.category_emoji, `Transaction ${index + 1} category icon`, { max: 16, fallback: '💳' });
  const transferId = item.transfer_id === undefined ? null : item.transfer_id;
  if (transferId !== null && (typeof transferId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(transferId))) fail(400, `Transaction ${index + 1} has an invalid transfer reference.`);
  if (item.wallet_id !== undefined && typeof item.wallet_id !== 'number') fail(400, `Transaction ${index + 1} wallet reference must be a number.`);
  if (item.wallet_id !== undefined) positiveId(item.wallet_id, `Transaction ${index + 1} wallet`);
  return { item, amount, category, type, walletType, date, note, emoji, transferId };
}
function validateImportedKhata(item, index) {
  const allowed = new Set(['id', 'wallet_id', 'wallet', 'friendName', 'friend_name', 'amount', 'date', 'lent_date', 'category', 'notes', 'note', 'category_emoji']);
  const amount = validateImportedAmount(item, index, 'Lent record', allowed);
  const friendName = cleanText(item.friendName === undefined ? item.friend_name : item.friendName, `Lent record ${index + 1} friend name`, { required: true, max: 80 });
  const category = cleanText(item.category, `Lent record ${index + 1} category`, { required: true, max: 80 });
  const walletType = item.wallet;
  if (walletType !== 'cash' && walletType !== 'online') fail(400, `Lent record ${index + 1} has an invalid wallet reference.`);
  const date = validDate(item.lent_date === undefined ? item.date : item.lent_date, `Lent record ${index + 1} date`);
  const note = cleanText(item.note === undefined ? item.notes : item.note, `Lent record ${index + 1} note`, { max: 500 });
  const emoji = cleanText(item.category_emoji, `Lent record ${index + 1} category icon`, { max: 16, fallback: '🤝' });
  if (item.wallet_id !== undefined && typeof item.wallet_id !== 'number') fail(400, `Lent record ${index + 1} wallet reference must be a number.`);
  if (item.wallet_id !== undefined) positiveId(item.wallet_id, `Lent record ${index + 1} wallet`);
  return { item, amount, friendName, category, walletType, date, note, emoji };
}
function validateImportedAmount(item, index, label, allowedFields) {
  if (!isObject(item)) fail(400, `${label} ${index + 1} must be an object.`);
  if (Object.keys(item).some(key => !allowedFields.has(key))) fail(400, `${label} ${index + 1} has unsupported fields.`);
  if (item.id !== undefined && typeof item.id !== 'number') fail(400, `${label} ${index + 1} ID must be a number.`);
  if (item.id !== undefined) positiveId(item.id, `${label} ${index + 1} ID`);
  if (typeof item.amount !== 'number') fail(400, `${label} ${index + 1} amount must be a number.`);
  return requirePositiveCents(item.amount, `${label} ${index + 1} amount`);
}
function importedRecordId(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  if (entry.item) return entry.item.id;
  return entry.id;
}
function validateImportedIds(groups) {
  for (const [items, label] of groups) {
    const ids = new Set();
    items.forEach((entry, index) => {
      const id = importedRecordId(entry);
      if (id === undefined) return;
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) fail(400, `${label} ${index + 1} has an invalid or duplicate ID.`);
      ids.add(id);
    });
  }
}
function validateTransferGroups(transactions) {
  const transferGroups = new Map();
  for (const entry of transactions) {
    const transferCategory = entry.category === 'Transfer Out' || entry.category === 'Transfer In';
    if (transferCategory && !entry.transferId) fail(400, 'Backup transfer records must include both sides of their transfer reference.');
    if (!entry.transferId) continue;
    if (!transferCategory) fail(400, 'A transfer reference can only be used by Transfer Out and Transfer In records.');
    if (!transferGroups.has(entry.transferId)) transferGroups.set(entry.transferId, []);
    transferGroups.get(entry.transferId).push(entry);
  }
  for (const pair of transferGroups.values()) {
    const outgoing = pair.find(entry => entry.category === 'Transfer Out' && entry.type === 'expense');
    const incoming = pair.find(entry => entry.category === 'Transfer In' && entry.type === 'income');
    if (pair.length !== 2 || !outgoing || !incoming || outgoing.amount !== incoming.amount ||
        outgoing.walletType === incoming.walletType || outgoing.date !== incoming.date) {
      fail(400, 'Backup transfer records must contain matching outgoing and incoming sides.');
    }
  }
  return transferGroups;
}
function validatePendingRecord(item, index) {
  if (!isObject(item)) fail(400, `Deferred item ${index + 1} must be an object.`);
  const pendingFields = new Set(['id', 'dueDate', 'amount', 'remainingAmount', 'status', 'settledAt', 'settlementWallet', 'settlementTransactionId', 'category', 'notes', 'fromWallet', 'wallet']);
  if (Object.keys(item).some(key => !pendingFields.has(key))) fail(400, `Deferred item ${index + 1} has unsupported fields.`);
  if (item.id !== undefined && typeof item.id !== 'number') fail(400, `Deferred item ${index + 1} ID must be a number.`);
  if (item.id !== undefined) positiveId(item.id, `Deferred item ${index + 1} ID`);
  if (typeof item.amount !== 'number') fail(400, `Deferred item ${index + 1} amount must be a number.`);
  const amountCents = requirePositiveCents(item.amount, `Deferred item ${index + 1} amount`);
  let status = 'outstanding';
  if (item.status !== undefined) status = item.status;
  if (status !== 'outstanding' && status !== 'settled') fail(400, `Deferred item ${index + 1} has an invalid status.`);
  let remainingCents = amountCents;
  if (status === 'settled') remainingCents = 0;
  if (item.remainingAmount !== undefined) remainingCents = moneyToCents(item.remainingAmount, `Deferred item ${index + 1} remaining amount`);
  if (remainingCents > amountCents || (status === 'settled' && remainingCents !== 0) ||
      (status === 'outstanding' && remainingCents === 0)) {
    fail(400, `Deferred item ${index + 1} has inconsistent settlement amounts.`);
  }
  cleanText(item.category, `Deferred item ${index + 1} category`, { required: true, max: 80 });
  if (item.notes !== undefined && typeof item.notes !== 'string') fail(400, `Deferred item ${index + 1} notes must be text.`);
  validDate(item.dueDate, `Deferred item ${index + 1} date`);
  let deferredWallet = item.wallet;
  if (item.fromWallet !== undefined) deferredWallet = item.fromWallet;
  if (deferredWallet !== undefined && deferredWallet !== 'cash' && deferredWallet !== 'online') fail(400, `Deferred item ${index + 1} has an invalid wallet reference.`);
  if (item.settlementWallet !== undefined && item.settlementWallet !== 'cash' && item.settlementWallet !== 'online') fail(400, `Deferred item ${index + 1} has an invalid settlement wallet.`);
  if (item.settledAt !== undefined) validDate(item.settledAt, `Deferred item ${index + 1} settlement date`);
  if (item.settlementTransactionId !== undefined) positiveId(item.settlementTransactionId, `Deferred item ${index + 1} settlement transaction`);
}
function validateImportPayload(body) {
  const allowedRootFields = new Set(['currentCashBalance', 'currentOnlineBalance', 'transactions', 'pendingLiabilities', 'lentRecords']);
  if (Object.keys(body).some(key => !allowedRootFields.has(key))) fail(400, 'Backup contains unsupported fields.');
  if (typeof body.currentCashBalance !== 'number' || typeof body.currentOnlineBalance !== 'number') fail(400, 'Backup wallet balances must be numbers.');
  const cashSnapshot = moneyToCents(body.currentCashBalance, 'Cash balance');
  const onlineSnapshot = moneyToCents(body.currentOnlineBalance, 'Online balance');
  if (!Array.isArray(body.transactions)) fail(400, 'Transactions must be an array.');
  if (body.transactions.length > 5000) fail(400, 'A backup can contain at most 5,000 transactions.');
  let pending = [];
  if (body.pendingLiabilities !== undefined) pending = body.pendingLiabilities;
  let lent = [];
  if (body.lentRecords !== undefined) lent = body.lentRecords;
  if (!Array.isArray(pending) || !Array.isArray(lent) || lent.length > 1000 || pending.length > 1000) {
    fail(400, 'Backup records must be valid arrays.');
  }
  const transactions = body.transactions.map(validateImportedTransaction);
  const khata = lent.map(validateImportedKhata);
  validateImportedIds([[transactions, 'Transaction'], [khata, 'Lent record'], [pending, 'Deferred item']]);
  const transferGroups = validateTransferGroups(transactions);
  pending.forEach(validatePendingRecord);
  return { cashSnapshot, onlineSnapshot, transactions, khata, transferGroups };
}
async function mergeImportedTransactions(tx, userId, transactions, transferGroups, walletsByType, deltas) {
  let importedTransactions = 0;
  let skippedTransactions = 0;
  const processedTransfers = new Set();
  for (const entry of transactions) {
    if (entry.transferId) {
      if (processedTransfers.has(entry.transferId)) continue;
      processedTransfers.add(entry.transferId);
      const pair = transferGroups.get(entry.transferId);
      let existingCount = 0;
      for (const leg of pair) {
        const importKey = importKeyForTransaction(leg);
        const wallet = walletsByType.get(leg.walletType);
        const matching = await findExistingImportedTransaction(tx, userId, leg, wallet.id, importKey);
        if (matching) existingCount += 1;
      }
      if (existingCount === pair.length) {
        skippedTransactions += pair.length;
        continue;
      }
      if (existingCount > 0) fail(409, 'Only one side of this backup transfer already exists; nothing was imported.');
      for (const leg of pair) {
        const importKey = importKeyForTransaction(leg);
        const wallet = walletsByType.get(leg.walletType);
        deltas.set(wallet.id, (deltas.get(wallet.id) || 0) + adjustmentFor(leg.type, leg.amount));
        await insertImportedTransaction(tx, userId, leg, wallet.id, importKey);
        importedTransactions += 1;
      }
      continue;
    }

    const importKey = importKeyForTransaction(entry);
    const wallet = walletsByType.get(entry.walletType);
    const existing = await findExistingImportedTransaction(tx, userId, entry, wallet.id, importKey);
    if (existing) {
      skippedTransactions += 1;
      continue;
    }
    const current = deltas.get(wallet.id) || 0;
    deltas.set(wallet.id, current + adjustmentFor(entry.type, entry.amount));
    const inserted = await insertImportedTransaction(tx, userId, entry, wallet.id, importKey);
    if (inserted.changes) importedTransactions += 1;
  }
  return { importedTransactions, skippedTransactions };
}
async function mergeImportedKhata(tx, userId, records, walletsByType, deltas) {
  let importedLentRecords = 0;
  let skippedLentRecords = 0;
  for (const entry of records) {
    const importKey = crypto.createHash('sha256').update(JSON.stringify([
      entry.walletType, entry.friendName, entry.amount, entry.category, entry.note, entry.date
    ])).digest('hex');
    const wallet = walletsByType.get(entry.walletType);
    const existing = await tx.get(`SELECT id FROM khata_records WHERE user_id = ? AND
      (import_key = ? OR (wallet_id = ? AND friend_name = ? AND original_amount = ? AND amount_repaid = 0 AND category = ? AND COALESCE(note, '') = ? AND lent_date = ?)) LIMIT 1`,
    [userId, importKey, wallet.id, entry.friendName, centsToMoney(entry.amount), entry.category, entry.note, entry.date]);
    if (existing) {
      skippedLentRecords += 1;
      continue;
    }
    deltas.set(wallet.id, (deltas.get(wallet.id) || 0) - entry.amount);
    await tx.run(`INSERT INTO khata_records
      (user_id, wallet_id, friend_name, original_amount, amount_repaid, category, category_emoji, note, lent_date, import_key)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [userId, wallet.id, entry.friendName, centsToMoney(entry.amount), entry.category, entry.emoji, entry.note, entry.date, importKey]);
    importedLentRecords += 1;
  }
  return { importedLentRecords, skippedLentRecords };
}
async function mergeImportedBackup(tx, userId, backup) {
  const wallets = await tx.all('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  const walletsByType = new Map(wallets.map(wallet => [wallet.type, wallet]));
  if (!walletsByType.has('cash') || !walletsByType.has('online')) fail(400, 'This account is missing a required wallet.');
  const existingFinancialRows = await tx.get(`SELECT
    (SELECT COUNT(*) FROM transactions WHERE user_id = ?) +
    (SELECT COUNT(*) FROM khata_records WHERE user_id = ?) AS count`, [userId, userId]);
  const restoreSnapshot = existingFinancialRows.count === 0 &&
    wallets.every(wallet => storedMoneyToCents(wallet.balance) === 0);
  for (const entry of [...backup.transactions, ...backup.khata]) {
    if (entry.item.wallet_id === undefined) continue;
    const referenced = wallets.find(wallet => wallet.id === Number(entry.item.wallet_id));
    if (!referenced || referenced.type !== entry.walletType) {
      fail(400, 'Backup contains a wallet reference that does not belong to this account.');
    }
  }
  const deltas = new Map();
  const transactionCounts = await mergeImportedTransactions(
    tx, userId, backup.transactions, backup.transferGroups, walletsByType, deltas
  );
  const khataCounts = await mergeImportedKhata(tx, userId, backup.khata, walletsByType, deltas);
  if (restoreSnapshot) {
    await applyWalletBalance(tx, userId, walletsByType.get('cash').id, backup.cashSnapshot);
    await applyWalletBalance(tx, userId, walletsByType.get('online').id, backup.onlineSnapshot);
  } else {
    for (const [walletId, delta] of deltas) {
      const wallet = wallets.find(item => item.id === walletId);
      await applyWalletBalance(tx, userId, walletId, storedMoneyToCents(wallet.balance) + delta);
    }
  }
  return { ...transactionCounts, ...khataCounts, restoredWalletBalances: restoreSnapshot };
}

app.post('/api/import', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const backup = validateImportPayload(body);
  const result = await db.transaction(tx => mergeImportedBackup(tx, req.user.id, backup));
  res.json({ success: true, message: 'Backup merged. Existing matching records were skipped.', ...result });
}, 'Unable to import this backup.'));

app.post('/api/khata/clear', authenticateToken, endpoint(async (req, res) => {
  await db.transaction(async tx => {
    const records = await tx.all('SELECT * FROM khata_records WHERE user_id = ?', [req.user.id]);
    const outstandingByWallet = new Map();
    for (const record of records) {
      const outstanding = storedMoneyToCents(record.original_amount) - storedMoneyToCents(record.amount_repaid);
      outstandingByWallet.set(record.wallet_id, (outstandingByWallet.get(record.wallet_id) || 0) + outstanding);
    }
    for (const [walletId, amount] of outstandingByWallet) {
      const wallet = await getOwnedWallet(tx, walletId, req.user.id);
      await applyWalletBalance(tx, req.user.id, walletId, storedMoneyToCents(wallet.balance) + amount);
    }
    await tx.run('DELETE FROM khata_repayments WHERE user_id = ?', [req.user.id]);
    await tx.run('DELETE FROM khata_records WHERE user_id = ?', [req.user.id]);
  });
  res.json({ success: true, message: 'Khata records cleared and outstanding amounts returned to wallets.' });
}, 'Unable to clear Khata records.'));

app.post('/api/reset', authenticateToken, endpoint(async (req, res) => {
  await db.transaction(async tx => {
    await tx.run('DELETE FROM khata_repayments WHERE user_id = ?', [req.user.id]);
    await tx.run('DELETE FROM khata_records WHERE user_id = ?', [req.user.id]);
    await tx.run('DELETE FROM transactions WHERE user_id = ?', [req.user.id]);
    await tx.run('UPDATE wallets SET balance = 0 WHERE user_id = ?', [req.user.id]);
  });
  res.json({ success: true, message: 'Account financial data reset.' });
}, 'Unable to reset account data.'));

app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'API endpoint not found.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && error.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'Request contains invalid JSON.' });
  if (error && error.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'Request is too large.' });
  console.error('Unhandled request error.');
  return res.status(500).json({ success: false, error: 'The request could not be completed.' });
});

if (require.main === module) {
  db.ready.then(() => {
    app.listen(PORT, () => console.log(`[Spendly Backend] Server listening on port ${PORT}.`));
  }).catch(() => {
    console.error('[Database] Initialization failed. Server was not started.');
    process.exitCode = 1;
  });
}

module.exports = app;
