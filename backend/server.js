const express = require('express');
const cors = require('cors');
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

app.use(cors());
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
  const id = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
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

async function authenticateToken(req, res, next) {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ success: false, error: 'Sign in to continue.' });
  try {
    const claims = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] });
    const id = positiveId(claims.id, 'Account');
    const user = await db.get('SELECT id FROM users WHERE id = ?', [id]);
    if (!user) return res.status(401).json({ success: false, error: 'Your session is no longer valid. Please sign in again.' });
    req.user = { id: user.id };
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

// AUTH
app.post('/api/register', endpoint(async (req, res) => {
  const body = requireBody(req);
  const name = cleanText(body.name, 'Name', { required: true, max: 80 });
  const email = cleanText(body.email, 'Email', { required: true, max: 254 }).toLowerCase();
  const password = body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) fail(400, 'Password must be at least 8 characters and no longer than 72 UTF-8 bytes.');
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) fail(409, 'An account with this email already exists.');
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.transaction(async tx => {
    const result = await tx.run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, passwordHash]);
    await tx.run('INSERT INTO wallets (user_id, name, type, balance, is_default) VALUES (?, ?, ?, ?, ?)', [result.lastID, 'Cash Wallet', 'cash', 0, 1]);
    await tx.run('INSERT INTO wallets (user_id, name, type, balance, is_default) VALUES (?, ?, ?, ?, ?)', [result.lastID, 'Online / Bank', 'online', 0, 0]);
    return { id: result.lastID, name, email };
  });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
  res.status(201).json({ success: true, message: 'Account created successfully.', token, user });
}, 'Unable to create your account.'));

app.post('/api/login', endpoint(async (req, res) => {
  const body = requireBody(req);
  const email = cleanText(body.email, 'Email', { required: true, max: 254 }).toLowerCase();
  if (typeof body.password !== 'string' || !body.password) fail(400, 'Email and password are required.');
  const user = await db.get('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) fail(401, 'Invalid email or password.');
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
  res.json({ success: true, message: 'Login successful.', token, user: { id: user.id, name: user.name, email: user.email } });
}, 'Unable to sign in.'));

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
  const type = body.type === undefined ? 'expense' : validatedType(body.type);
  const amount = requirePositiveCents(body.amount);
  const category = cleanText(body.category, 'Category', { required: true, max: 80 });
  const emoji = cleanText(body.category_emoji, 'Category icon', { max: 16, fallback: '💳' });
  const note = cleanText(body.note, 'Note', { max: 500 });
  const date = dateOrNow(body.transaction_date, 'Transaction date');
  const transaction = await db.transaction(async tx => {
    const wallet = await getOwnedWallet(tx, walletId, req.user.id);
    const newBalance = storedMoneyToCents(wallet.balance) + adjustmentFor(type, amount);
    await applyWalletBalance(tx, req.user.id, walletId, newBalance);
    const result = await tx.run(`INSERT INTO transactions
      (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [req.user.id, walletId, type, centsToMoney(amount), category, emoji, note, date]);
    return tx.get(`SELECT t.*, w.name AS wallet_name, w.type AS wallet_type FROM transactions t
      JOIN wallets w ON w.id = t.wallet_id WHERE t.id = ? AND t.user_id = ?`, [result.lastID, req.user.id]);
  });
  res.status(201).json({ success: true, transaction });
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

app.delete('/api/transactions/:id', authenticateToken, endpoint(async (req, res) => {
  const txId = positiveId(req.params.id, 'Transaction');
  const deletedTransfer = await db.transaction(async tx => {
    const record = await tx.get('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [txId, req.user.id]);
    if (!record) fail(404, 'Transaction not found.');
    if (record.transfer_id || record.category === 'Transfer Out' || record.category === 'Transfer In') {
      let pair;
      if (record.transfer_id) {
        pair = await tx.all('SELECT * FROM transactions WHERE user_id = ? AND transfer_id = ?', [req.user.id, record.transfer_id]);
      } else {
        const outgoing = record.category === 'Transfer Out' && record.type === 'expense';
        const incoming = record.category === 'Transfer In' && record.type === 'income';
        if (!outgoing && !incoming) fail(409, 'This older transfer is incomplete and cannot be safely removed.');
        const category = outgoing ? 'Transfer In' : 'Transfer Out';
        const type = outgoing ? 'income' : 'expense';
        const candidates = await tx.all(`SELECT * FROM transactions WHERE user_id = ? AND category = ? AND type = ? AND amount = ? AND transaction_date = ?`,
          [req.user.id, category, type, record.amount, record.transaction_date]);
        const currentWallet = await getOwnedWallet(tx, record.wallet_id, req.user.id);
        const currentNote = String(record.note || '');
        const separator = currentNote.indexOf(':');
        const memo = separator < 0 ? null : currentNote.slice(separator + 1).trim();
        const matching = [];
        for (const candidate of candidates) {
          const otherWallet = await getOwnedWallet(tx, candidate.wallet_id, req.user.id);
          const candidateNote = String(candidate.note || '');
          const otherSeparator = candidateNote.indexOf(':');
          const otherMemo = otherSeparator < 0 ? null : candidateNote.slice(otherSeparator + 1).trim();
          if (otherWallet.id !== currentWallet.id && otherMemo !== null && otherMemo === memo) matching.push(candidate);
        }
        if (matching.length !== 1) fail(409, 'This older transfer has no unique matching side and cannot be safely removed.');
        pair = [record, matching[0]];
      }
      const outgoing = pair.find(leg => leg.category === 'Transfer Out' && leg.type === 'expense');
      const incoming = pair.find(leg => leg.category === 'Transfer In' && leg.type === 'income');
      if (pair.length !== 2 || !outgoing || !incoming || outgoing.amount !== incoming.amount || outgoing.wallet_id === incoming.wallet_id || outgoing.transaction_date !== incoming.transaction_date) {
        fail(409, 'This transfer is incomplete and cannot be safely removed.');
      }
      const changes = new Map();
      for (const leg of pair) {
        const wallet = await getOwnedWallet(tx, leg.wallet_id, req.user.id);
        const restore = -adjustmentFor(leg.type, storedMoneyToCents(leg.amount));
        changes.set(wallet.id, (changes.get(wallet.id) || 0) + restore);
      }
      for (const [walletId, delta] of changes) {
        const wallet = await getOwnedWallet(tx, walletId, req.user.id);
        await applyWalletBalance(tx, req.user.id, walletId, storedMoneyToCents(wallet.balance) + delta);
      }
      const result = record.transfer_id
        ? await tx.run('DELETE FROM transactions WHERE user_id = ? AND transfer_id = ?', [req.user.id, record.transfer_id])
        : await tx.run('DELETE FROM transactions WHERE user_id = ? AND id IN (?, ?)', [req.user.id, pair[0].id, pair[1].id]);
      if (result.changes !== 2) fail(409, 'This transfer changed before it could be removed.');
      return true;
    }
    const wallet = await getOwnedWallet(tx, record.wallet_id, req.user.id);
    const restore = -adjustmentFor(record.type, storedMoneyToCents(record.amount));
    await applyWalletBalance(tx, req.user.id, wallet.id, storedMoneyToCents(wallet.balance) + restore);
    await tx.run('DELETE FROM transactions WHERE id = ? AND user_id = ?', [txId, req.user.id]);
    return false;
  });
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
  if (!isObject(item)) fail(400, `Transaction ${index + 1} must be an object.`);
  if (Object.keys(item).some(key => !IMPORT_FIELDS.has(key))) fail(400, `Transaction ${index + 1} has unsupported fields.`);
  if (item.id !== undefined && typeof item.id !== 'number') fail(400, `Transaction ${index + 1} ID must be a number.`);
  if (item.id !== undefined) positiveId(item.id, `Transaction ${index + 1} ID`);
  if (typeof item.amount !== 'number') fail(400, `Transaction ${index + 1} amount must be a number.`);
  const amount = requirePositiveCents(item.amount, `Transaction ${index + 1} amount`);
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
  if (!isObject(item)) fail(400, `Lent record ${index + 1} must be an object.`);
  const allowed = new Set(['id', 'wallet_id', 'wallet', 'friendName', 'friend_name', 'amount', 'date', 'lent_date', 'category', 'notes', 'note', 'category_emoji']);
  if (Object.keys(item).some(key => !allowed.has(key))) fail(400, `Lent record ${index + 1} has unsupported fields.`);
  if (item.id !== undefined && typeof item.id !== 'number') fail(400, `Lent record ${index + 1} ID must be a number.`);
  if (item.id !== undefined) positiveId(item.id, `Lent record ${index + 1} ID`);
  if (typeof item.amount !== 'number') fail(400, `Lent record ${index + 1} amount must be a number.`);
  const amount = requirePositiveCents(item.amount, `Lent record ${index + 1} amount`);
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

app.post('/api/import', authenticateToken, endpoint(async (req, res) => {
  const body = requireBody(req);
  const allowedRootFields = new Set(['currentCashBalance', 'currentOnlineBalance', 'transactions', 'pendingLiabilities', 'lentRecords']);
  if (Object.keys(body).some(key => !allowedRootFields.has(key))) fail(400, 'Backup contains unsupported fields.');
  if (typeof body.currentCashBalance !== 'number' || typeof body.currentOnlineBalance !== 'number') fail(400, 'Backup wallet balances must be numbers.');
  const cashSnapshot = moneyToCents(body.currentCashBalance, 'Cash balance');
  const onlineSnapshot = moneyToCents(body.currentOnlineBalance, 'Online balance');
  if (!Array.isArray(body.transactions)) fail(400, 'Transactions must be an array.');
  if (body.transactions.length > 5000) fail(400, 'A backup can contain at most 5,000 transactions.');
  const pending = body.pendingLiabilities === undefined ? [] : body.pendingLiabilities;
  const lent = body.lentRecords === undefined ? [] : body.lentRecords;
  if (!Array.isArray(pending) || !Array.isArray(lent) || lent.length > 1000 || pending.length > 1000) fail(400, 'Backup records must be valid arrays.');
  const transactions = body.transactions.map(validateImportedTransaction);
  const khata = lent.map(validateImportedKhata);
  for (const [items, label] of [[transactions, 'Transaction'], [khata, 'Lent record'], [pending, 'Deferred item']]) {
    const ids = new Set();
    items.forEach((entry, index) => {
      const id = entry && typeof entry === 'object' ? (entry.item ? entry.item.id : entry.id) : undefined;
      if (id === undefined) return;
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) fail(400, `${label} ${index + 1} has an invalid or duplicate ID.`);
      ids.add(id);
    });
  }
  const transferGroups = new Map();
  transactions.forEach(entry => {
    const transferCategory = entry.category === 'Transfer Out' || entry.category === 'Transfer In';
    if (transferCategory && !entry.transferId) fail(400, 'Backup transfer records must include both sides of their transfer reference.');
    if (entry.transferId) {
      if (!transferCategory) fail(400, 'A transfer reference can only be used by Transfer Out and Transfer In records.');
      if (!transferGroups.has(entry.transferId)) transferGroups.set(entry.transferId, []);
      transferGroups.get(entry.transferId).push(entry);
    }
  });
  for (const pair of transferGroups.values()) {
    const outgoing = pair.find(entry => entry.category === 'Transfer Out' && entry.type === 'expense');
    const incoming = pair.find(entry => entry.category === 'Transfer In' && entry.type === 'income');
    if (pair.length !== 2 || !outgoing || !incoming || outgoing.amount !== incoming.amount || outgoing.walletType === incoming.walletType || outgoing.date !== incoming.date) {
      fail(400, 'Backup transfer records must contain matching outgoing and incoming sides.');
    }
  }
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    if (!isObject(item)) fail(400, `Deferred item ${index + 1} must be an object.`);
    const pendingFields = new Set(['id', 'dueDate', 'amount', 'category', 'notes', 'fromWallet', 'wallet']);
    if (Object.keys(item).some(key => !pendingFields.has(key))) fail(400, `Deferred item ${index + 1} has unsupported fields.`);
    if (item.id !== undefined && typeof item.id !== 'number') fail(400, `Deferred item ${index + 1} ID must be a number.`);
    if (item.id !== undefined) positiveId(item.id, `Deferred item ${index + 1} ID`);
    if (typeof item.amount !== 'number') fail(400, `Deferred item ${index + 1} amount must be a number.`);
    requirePositiveCents(item.amount, `Deferred item ${index + 1} amount`);
    cleanText(item.category, `Deferred item ${index + 1} category`, { required: true, max: 80 });
    if (item.notes !== undefined && typeof item.notes !== 'string') fail(400, `Deferred item ${index + 1} notes must be text.`);
    validDate(item.dueDate, `Deferred item ${index + 1} date`);
    const deferredWallet = item.fromWallet === undefined ? item.wallet : item.fromWallet;
    if (deferredWallet !== undefined && deferredWallet !== 'cash' && deferredWallet !== 'online') fail(400, `Deferred item ${index + 1} has an invalid wallet reference.`);
  }

  const result = await db.transaction(async tx => {
    const wallets = await tx.all('SELECT * FROM wallets WHERE user_id = ?', [req.user.id]);
    const byType = new Map(wallets.map(wallet => [wallet.type, wallet]));
    if (!byType.has('cash') || !byType.has('online')) fail(400, 'This account is missing a required wallet.');
    const existingFinancialRows = await tx.get(`SELECT
      (SELECT COUNT(*) FROM transactions WHERE user_id = ?) +
      (SELECT COUNT(*) FROM khata_records WHERE user_id = ?) AS count`, [req.user.id, req.user.id]);
    const restoreSnapshot = existingFinancialRows.count === 0 && wallets.every(wallet => storedMoneyToCents(wallet.balance) === 0);
    for (const entry of [...transactions, ...khata]) {
      if (entry.item.wallet_id !== undefined) {
        const referenced = wallets.find(wallet => wallet.id === Number(entry.item.wallet_id));
        if (!referenced || referenced.type !== entry.walletType) fail(400, 'Backup contains a wallet reference that does not belong to this account.');
      }
    }

    const deltas = new Map();
    let importedTransactions = 0;
    let skippedTransactions = 0;
    let importedLentRecords = 0;
    let skippedLentRecords = 0;
    const processedTransfers = new Set();
    for (const entry of transactions) {
      if (entry.transferId) {
        if (processedTransfers.has(entry.transferId)) continue;
        processedTransfers.add(entry.transferId);
        const pair = transferGroups.get(entry.transferId);
        let existingCount = 0;
        for (const leg of pair) {
          const key = crypto.createHash('sha256').update(JSON.stringify([
            leg.walletType, leg.type, leg.amount, leg.category, leg.emoji, leg.note, leg.date
          ])).digest('hex');
          const matching = await tx.get(`SELECT id FROM transactions WHERE user_id = ? AND
            (import_key = ? OR (wallet_id = ? AND type = ? AND amount = ? AND category = ? AND COALESCE(note, '') = ? AND transaction_date = ?)) LIMIT 1`,
          [req.user.id, key, byType.get(leg.walletType).id, leg.type, centsToMoney(leg.amount), leg.category, leg.note, leg.date]);
          if (matching) existingCount += 1;
        }
        if (existingCount === pair.length) {
          skippedTransactions += pair.length;
          continue;
        }
        if (existingCount > 0) fail(409, 'Only one side of this backup transfer already exists; nothing was imported.');
        for (const leg of pair) {
          const key = crypto.createHash('sha256').update(JSON.stringify([
            leg.walletType, leg.type, leg.amount, leg.category, leg.emoji, leg.note, leg.date
          ])).digest('hex');
          const wallet = byType.get(leg.walletType);
          deltas.set(wallet.id, (deltas.get(wallet.id) || 0) + adjustmentFor(leg.type, leg.amount));
          await tx.run(`INSERT INTO transactions
            (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date, import_key, transfer_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [req.user.id, wallet.id, leg.type, centsToMoney(leg.amount), leg.category, leg.emoji, leg.note, leg.date, key, leg.transferId]);
          importedTransactions += 1;
        }
        continue;
      }
      const key = crypto.createHash('sha256').update(JSON.stringify([
        entry.walletType, entry.type, entry.amount, entry.category, entry.emoji, entry.note, entry.date
      ])).digest('hex');
      const existing = await tx.get(`SELECT id FROM transactions WHERE user_id = ? AND
        (import_key = ? OR (wallet_id = ? AND type = ? AND amount = ? AND category = ? AND COALESCE(note, '') = ? AND transaction_date = ?)) LIMIT 1`,
      [req.user.id, key, byType.get(entry.walletType).id, entry.type, centsToMoney(entry.amount), entry.category, entry.note, entry.date]);
      if (existing) { skippedTransactions += 1; continue; }
      const wallet = byType.get(entry.walletType);
      const current = deltas.get(wallet.id) || 0;
      deltas.set(wallet.id, current + adjustmentFor(entry.type, entry.amount));
      const inserted = await tx.run(`INSERT INTO transactions
        (user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date, import_key, transfer_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [req.user.id, wallet.id, entry.type, centsToMoney(entry.amount), entry.category, entry.emoji, entry.note, entry.date, key, entry.transferId]);
      if (inserted.changes) importedTransactions += 1;
    }
    for (const entry of khata) {
      const key = crypto.createHash('sha256').update(JSON.stringify([
        entry.walletType, entry.friendName, entry.amount, entry.category, entry.note, entry.date
      ])).digest('hex');
      const existing = await tx.get(`SELECT id FROM khata_records WHERE user_id = ? AND
        (import_key = ? OR (wallet_id = ? AND friend_name = ? AND original_amount = ? AND amount_repaid = 0 AND category = ? AND COALESCE(note, '') = ? AND lent_date = ?)) LIMIT 1`,
      [req.user.id, key, byType.get(entry.walletType).id, entry.friendName, centsToMoney(entry.amount), entry.category, entry.note, entry.date]);
      if (existing) { skippedLentRecords += 1; continue; }
      const wallet = byType.get(entry.walletType);
      deltas.set(wallet.id, (deltas.get(wallet.id) || 0) - entry.amount);
      await tx.run(`INSERT INTO khata_records
        (user_id, wallet_id, friend_name, original_amount, amount_repaid, category, category_emoji, note, lent_date, import_key)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`, [req.user.id, wallet.id, entry.friendName, centsToMoney(entry.amount), entry.category, entry.emoji, entry.note, entry.date, key]);
      importedLentRecords += 1;
    }
    if (restoreSnapshot) {
      await applyWalletBalance(tx, req.user.id, byType.get('cash').id, cashSnapshot);
      await applyWalletBalance(tx, req.user.id, byType.get('online').id, onlineSnapshot);
    } else {
      for (const [walletId, delta] of deltas) {
        const wallet = wallets.find(item => item.id === walletId);
        await applyWalletBalance(tx, req.user.id, walletId, storedMoneyToCents(wallet.balance) + delta);
      }
    }
    return { importedTransactions, skippedTransactions, importedLentRecords, skippedLentRecords,
      restoredWalletBalances: restoreSnapshot };
  });
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

db.ready.then(() => {
  app.listen(PORT, () => console.log(`[Spendly Backend] Server listening on port ${PORT}.`));
}).catch(() => {
  console.error('[Database] Initialization failed. Server was not started.');
  process.exitCode = 1;
});
