const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spendly-legacy-db-test-'));
const databasePath = path.join(testDirectory, 'legacy-test.db');
let db;

function run(database, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, parameters, error => error ? reject(error) : resolve());
  });
}

function get(database, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, parameters, (error, row) => error ? reject(error) : resolve(row));
  });
}

function all(database, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

before(async () => {
  const legacy = new sqlite3.Database(databasePath);
  await run(legacy, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, password_hash TEXT)');
  await run(legacy, 'CREATE TABLE wallets (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, type TEXT, balance REAL, is_default INTEGER)');
  await run(legacy, `CREATE TABLE transactions (
    id INTEGER PRIMARY KEY, user_id INTEGER, wallet_id INTEGER, type TEXT, amount REAL,
    category TEXT, category_emoji TEXT, note TEXT, transaction_date TEXT
  )`);
  await run(legacy, `CREATE TABLE khata_records (
    id INTEGER PRIMARY KEY, user_id INTEGER, wallet_id INTEGER, friend_name TEXT,
    original_amount REAL, amount_repaid REAL, category TEXT, category_emoji TEXT,
    note TEXT, status TEXT, lent_date TEXT, settled_date TEXT
  )`);
  await run(legacy, 'INSERT INTO users (id, name, email, password_hash) VALUES (1, ?, ?, ?)', [
    'Legacy Fixture', 'legacy-fixture@example.invalid', 'synthetic-hash'
  ]);
  await run(legacy, 'INSERT INTO wallets (id, user_id, name, type, balance, is_default) VALUES (1, 1, ?, ?, 12.5, 1)', [
    'Fixture Cash', 'cash'
  ]);
  await run(legacy, `INSERT INTO transactions
    (id, user_id, wallet_id, type, amount, category, category_emoji, note, transaction_date)
    VALUES (1, 1, 1, 'expense', 1.25, 'Fixture', 'x', 'preserve fixture', '2020-01-01')`);
  await run(legacy, `INSERT INTO khata_records
    (id, user_id, wallet_id, friend_name, original_amount, amount_repaid, category, category_emoji, note, status, lent_date)
    VALUES (1, 1, 1, 'Fixture Contact', 2, 0, 'Fixture', 'x', '', 'outstanding', '2020-01-01')`);
  await close(legacy);

  process.env.SPENDLY_DB_PATH = databasePath;
  process.env.NODE_ENV = 'test';
  db = require('../database');
  await db.ready;
});

test('database initialization adds only nullable import/transfer columns to an older schema', async () => {
  const transactionColumns = await db.all('PRAGMA table_info(transactions)');
  const khataColumns = await db.all('PRAGMA table_info(khata_records)');
  const transactionNames = transactionColumns.map(column => column.name);
  const khataNames = khataColumns.map(column => column.name);

  assert.ok(transactionNames.includes('import_key'));
  assert.ok(transactionNames.includes('transfer_id'));
  assert.ok(khataNames.includes('import_key'));

  const transaction = await db.get('SELECT amount, note, transaction_date FROM transactions WHERE id = 1');
  const khata = await db.get('SELECT original_amount, friend_name, status FROM khata_records WHERE id = 1');
  const wallet = await db.get('SELECT balance FROM wallets WHERE id = 1');
  assert.deepEqual(transaction, { amount: 1.25, note: 'preserve fixture', transaction_date: '2020-01-01' });
  assert.deepEqual(khata, { original_amount: 2, friend_name: 'Fixture Contact', status: 'outstanding' });
  assert.equal(wallet.balance, 12.5);
});

after(async () => {
  if (db) await close(db.db);
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
