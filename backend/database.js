const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'spendly.db');
const db = new sqlite3.Database(DB_PATH);

function directRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function directGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function directAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

const ready = (async () => {
  await directRun('PRAGMA foreign_keys = ON');
  await directRun('PRAGMA journal_mode = WAL');

  await directRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await directRun(`CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'cash',
    balance REAL NOT NULL DEFAULT 0.0 CHECK (balance >= 0),
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await directRun(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    wallet_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
    amount REAL NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    category_emoji TEXT DEFAULT '💳',
    note TEXT,
    transaction_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    import_key TEXT,
    transfer_id TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
  )`);
  await directRun(`CREATE TABLE IF NOT EXISTS khata_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    wallet_id INTEGER NOT NULL,
    friend_name TEXT NOT NULL,
    original_amount REAL NOT NULL CHECK (original_amount > 0),
    amount_repaid REAL NOT NULL DEFAULT 0.0 CHECK (amount_repaid >= 0 AND amount_repaid <= original_amount),
    category TEXT NOT NULL,
    category_emoji TEXT DEFAULT '🤝',
    note TEXT,
    status TEXT NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding', 'settled')),
    lent_date TEXT NOT NULL,
    settled_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    import_key TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
  )`);
  await directRun(`CREATE TABLE IF NOT EXISTS khata_repayments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    khata_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    note TEXT,
    repayment_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (khata_id) REFERENCES khata_records(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Older installations gain only nullable import and transfer keys; financial values are untouched.
  const transactionColumns = await directAll('PRAGMA table_info(transactions)');
  if (!transactionColumns.some(column => column.name === 'import_key')) {
    await directRun('ALTER TABLE transactions ADD COLUMN import_key TEXT');
  }
  if (!transactionColumns.some(column => column.name === 'transfer_id')) {
    await directRun('ALTER TABLE transactions ADD COLUMN transfer_id TEXT');
  }
  const khataColumns = await directAll('PRAGMA table_info(khata_records)');
  if (!khataColumns.some(column => column.name === 'import_key')) {
    await directRun('ALTER TABLE khata_records ADD COLUMN import_key TEXT');
  }

  await directRun('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  await directRun('CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id)');
  await directRun('CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, transaction_date DESC)');
  await directRun('CREATE INDEX IF NOT EXISTS idx_khata_user ON khata_records(user_id)');
  await directRun('CREATE INDEX IF NOT EXISTS idx_khata_repayments ON khata_repayments(khata_id)');
  await directRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_import_key ON transactions(user_id, import_key) WHERE import_key IS NOT NULL');
  await directRun('CREATE INDEX IF NOT EXISTS idx_tx_transfer_id ON transactions(user_id, transfer_id) WHERE transfer_id IS NOT NULL');
  await directRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_khata_import_key ON khata_records(user_id, import_key) WHERE import_key IS NOT NULL');

  // Keep user and wallet ownership consistent even if a future route misses a check.
  await directRun(`CREATE TRIGGER IF NOT EXISTS transactions_wallet_owner_insert
    BEFORE INSERT ON transactions
    WHEN (SELECT user_id FROM wallets WHERE id = NEW.wallet_id) != NEW.user_id
    BEGIN SELECT RAISE(ABORT, 'wallet ownership mismatch'); END`);
  await directRun(`CREATE TRIGGER IF NOT EXISTS transactions_wallet_owner_update
    BEFORE UPDATE OF wallet_id, user_id ON transactions
    WHEN (SELECT user_id FROM wallets WHERE id = NEW.wallet_id) != NEW.user_id
    BEGIN SELECT RAISE(ABORT, 'wallet ownership mismatch'); END`);
  await directRun(`CREATE TRIGGER IF NOT EXISTS khata_wallet_owner_insert
    BEFORE INSERT ON khata_records
    WHEN (SELECT user_id FROM wallets WHERE id = NEW.wallet_id) != NEW.user_id
    BEGIN SELECT RAISE(ABORT, 'wallet ownership mismatch'); END`);
  await directRun(`CREATE TRIGGER IF NOT EXISTS khata_wallet_owner_update
    BEFORE UPDATE OF wallet_id, user_id ON khata_records
    WHEN (SELECT user_id FROM wallets WHERE id = NEW.wallet_id) != NEW.user_id
    BEGIN SELECT RAISE(ABORT, 'wallet ownership mismatch'); END`);
  await directRun(`CREATE TRIGGER IF NOT EXISTS repayment_owner_insert
    BEFORE INSERT ON khata_repayments
    WHEN (SELECT user_id FROM khata_records WHERE id = NEW.khata_id) != NEW.user_id
    BEGIN SELECT RAISE(ABORT, 'repayment ownership mismatch'); END`);
})();

// All operations share a queue so a transaction cannot interleave with another request.
let operationQueue = Promise.resolve();
function enqueue(operation) {
  const current = operationQueue.then(operation);
  operationQueue = current.catch(() => {});
  return current;
}

function transaction(work) {
  return enqueue(async () => {
    await ready;
    await directRun('BEGIN IMMEDIATE');
    const tx = { run: directRun, get: directGet, all: directAll };
    try {
      const result = await work(tx);
      await directRun('COMMIT');
      return result;
    } catch (error) {
      try { await directRun('ROLLBACK'); } catch {}
      throw error;
    }
  });
}

const query = {
  ready,
  transaction,
  run(sql, params = []) { return enqueue(async () => { await ready; return directRun(sql, params); }); },
  get(sql, params = []) { return enqueue(async () => { await ready; return directGet(sql, params); }); },
  all(sql, params = []) { return enqueue(async () => { await ready; return directAll(sql, params); }); },
  db
};

module.exports = query;
