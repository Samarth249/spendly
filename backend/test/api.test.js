
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Configure the isolated test environment BEFORE importing the app or database.
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spendly-test-'));
process.env.SPENDLY_DB_PATH = path.join(testDirectory, 'spendly-test.db');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.BCRYPT_ROUNDS = '10';
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = '10';
process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS = '900';
const testPassword = crypto.randomBytes(24).toString('base64url');
const incorrectPassword = crypto.randomBytes(24).toString('base64url');

const app = require('../server');
const db = require('../database');

let server;
let baseUrl;
let authToken;
let testEmail;

before(async () => {
  await db.ready;

  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
  testEmail = `test-${process.pid}-${Date.now()}@example.com`;
});

async function request(endpoint, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...options.headers
  };

  return fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}

test('registration rejects an invalid email address', async () => {
  const response = await request('/api/register', {
    method: 'POST',
    body: {
      name: 'Test User',
      email: 'not-an-email',
      password: testPassword
    }
  });

  assert.equal(response.status, 400);
});

test('registration creates an account and default wallets', async () => {
  const response = await request('/api/register', {
    method: 'POST',
    body: {
      name: 'Spendly Test User',
      email: testEmail,
      password: testPassword
    }
  });

  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.success, true);
  assert.equal(result.user.email, testEmail);
  assert.equal(typeof result.token, 'string');
  assert.ok(result.token.length > 0);

  authToken = result.token;
});

test('registration rejects a duplicate email address', async () => {
  const response = await request('/api/register', {
    method: 'POST',
    body: {
      name: 'Duplicate User',
      email: testEmail,
      password: testPassword
    }
  });

  assert.equal(response.status, 409);
});

test('login rejects an incorrect password', async () => {
  const response = await request('/api/login', {
    method: 'POST',
    body: {
      email: testEmail,
      password: incorrectPassword
    }
  });

  assert.equal(response.status, 401);
});

test('login accepts valid credentials', async () => {
  const response = await request('/api/login', {
    method: 'POST',
    body: {
      email: testEmail,
      password: testPassword
    }
  });

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.user.email, testEmail);
  assert.equal(typeof result.token, 'string');
  authToken = result.token;
});

test('profile endpoint rejects unauthenticated requests', async () => {
  const response = await request('/api/me');

  assert.equal(response.status, 401);
});

test('profile endpoint returns the authenticated user', async () => {
  const response = await request('/api/me', { token: authToken });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.user.email, testEmail);
});

test('wallet endpoint returns the user default wallets', async () => {
  const response = await request('/api/wallets', { token: authToken });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.wallets.length, 2);
});

async function readWallets() {
  const response = await request('/api/wallets', { token: authToken });
  assert.equal(response.status, 200);
  return (await response.json()).wallets;
}

async function readBalances() {
  return Object.fromEntries((await readWallets()).map(wallet => [wallet.type, wallet.balance]));
}

test('wallet deposits validate amounts and update only the owned wallet', async () => {
  const [cashWallet, onlineWallet] = await readWallets();
  const deposit = await request(`/api/wallets/${cashWallet.id}/deposit`, {
    method: 'POST',
    token: authToken,
    body: { amount: '100.00' }
  });
  const result = await deposit.json();

  assert.equal(deposit.status, 200);
  assert.equal(result.wallet.balance, 100);

  const zeroDeposit = await request(`/api/wallets/${cashWallet.id}/deposit`, {
    method: 'POST',
    token: authToken,
    body: { amount: 0 }
  });
  assert.equal(zeroDeposit.status, 400);

  const missingWallet = await request('/api/wallets/999999/deposit', {
    method: 'POST',
    token: authToken,
    body: { amount: 1 }
  });
  assert.equal(missingWallet.status, 404);
  assert.equal(onlineWallet.balance, 0);
});

test('transactions support idempotent creation, updates, and balance restoration on deletion', async () => {
  const [cashWallet, onlineWallet] = await readWallets();
  const transactionBody = {
    wallet_id: cashWallet.id,
    type: 'expense',
    amount: '12.34',
    category: 'Groceries',
    note: 'Weekly shop',
    transaction_date: '2026-10-20',
    idempotency_key: 'test-expense-1'
  };
  const createdResponse = await request('/api/transactions', {
    method: 'POST',
    token: authToken,
    body: transactionBody
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.transaction.amount, 12.34);
  assert.equal(created.wallet.balance, 87.66);

  const replayResponse = await request('/api/transactions', {
    method: 'POST',
    token: authToken,
    body: transactionBody
  });
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.replayed, true);
  assert.equal((await readBalances()).cash, 87.66);

  const conflictingReplay = await request('/api/transactions', {
    method: 'POST',
    token: authToken,
    body: { ...transactionBody, category: 'Different category' }
  });
  assert.equal(conflictingReplay.status, 409);

  const invalidAmount = await request('/api/transactions', {
    method: 'POST',
    token: authToken,
    body: { ...transactionBody, idempotency_key: undefined, amount: '1.005' }
  });
  assert.equal(invalidAmount.status, 400);

  const updatedResponse = await request(`/api/transactions/${created.transaction.id}`, {
    method: 'PUT',
    token: authToken,
    body: {
      wallet_id: onlineWallet.id,
      type: 'income',
      amount: '5.67',
      category: 'Refund',
      note: 'Returned item',
      transaction_date: '2026-10-21'
    }
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.equal(updated.transaction.wallet_id, onlineWallet.id);
  assert.deepEqual(await readBalances(), { cash: 100, online: 5.67 });

  const missingUpdate = await request('/api/transactions/999999', {
    method: 'PUT',
    token: authToken,
    body: { wallet_id: cashWallet.id, type: 'expense', amount: 1, category: 'Missing' }
  });
  assert.equal(missingUpdate.status, 404);

  const deletedResponse = await request(`/api/transactions/${created.transaction.id}`, {
    method: 'DELETE',
    token: authToken
  });
  assert.equal(deletedResponse.status, 200);
  assert.deepEqual(await readBalances(), { cash: 100, online: 0 });

  const missingDelete = await request('/api/transactions/999999', {
    method: 'DELETE',
    token: authToken
  });
  assert.equal(missingDelete.status, 404);
});

test('wallet transfers move funds atomically and delete both transaction legs', async () => {
  const [cashWallet, onlineWallet] = await readWallets();
  const sameWallet = await request('/api/wallets/transfer', {
    method: 'POST',
    token: authToken,
    body: { from_wallet_id: cashWallet.id, to_wallet_id: cashWallet.id, amount: 1 }
  });
  assert.equal(sameWallet.status, 400);

  const insufficientFunds = await request('/api/wallets/transfer', {
    method: 'POST',
    token: authToken,
    body: { from_wallet_id: cashWallet.id, to_wallet_id: onlineWallet.id, amount: 100.01 }
  });
  assert.equal(insufficientFunds.status, 400);

  const transferResponse = await request('/api/wallets/transfer', {
    method: 'POST',
    token: authToken,
    body: { from_wallet_id: cashWallet.id, to_wallet_id: onlineWallet.id, amount: 10, note: 'Savings' }
  });
  assert.equal(transferResponse.status, 200);
  assert.deepEqual(await readBalances(), { cash: 90, online: 10 });

  const transactionsResponse = await request('/api/transactions', { token: authToken });
  const transactions = (await transactionsResponse.json()).transactions;
  assert.equal(transactions.length, 2);

  const deletion = await request(`/api/transactions/${transactions[0].id}`, {
    method: 'DELETE',
    token: authToken
  });
  assert.equal(deletion.status, 200);
  assert.deepEqual(await readBalances(), { cash: 100, online: 0 });
});

test('Khata lending, partial and full repayment, and clearing preserve wallet balances', async () => {
  const [cashWallet, onlineWallet] = await readWallets();
  const createdResponse = await request('/api/khata', {
    method: 'POST',
    token: authToken,
    body: {
      wallet_id: cashWallet.id,
      friend_name: 'Test Contact',
      amount: 20,
      category: 'Lunch',
      lent_date: '2026-10-20'
    }
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.record.outstanding, 20);
  assert.deepEqual(await readBalances(), { cash: 80, online: 0 });

  const overpayment = await request(`/api/khata/${created.record.id}/repay`, {
    method: 'POST',
    token: authToken,
    body: { amount: 20.01 }
  });
  assert.equal(overpayment.status, 400);

  const partialRepayment = await request(`/api/khata/${created.record.id}/repay`, {
    method: 'POST',
    token: authToken,
    body: { amount: 7.25, wallet_id: onlineWallet.id, repayment_date: '2026-10-21' }
  });
  const partial = await partialRepayment.json();
  assert.equal(partialRepayment.status, 200);
  assert.equal(partial.record.outstanding, 12.75);
  assert.equal(partial.record.repayments.length, 1);

  const fullRepayment = await request(`/api/khata/${created.record.id}/repay`, {
    method: 'POST',
    token: authToken,
    body: { amount: 12.75, repayment_date: '2026-10-22' }
  });
  assert.equal(fullRepayment.status, 200);
  assert.equal((await fullRepayment.json()).record.status, 'settled');
  assert.deepEqual(await readBalances(), { cash: 92.75, online: 7.25 });

  const settledRepayment = await request(`/api/khata/${created.record.id}/repay`, {
    method: 'POST',
    token: authToken,
    body: { amount: 1 }
  });
  assert.equal(settledRepayment.status, 400);

  const clearedLoan = await request('/api/khata', {
    method: 'POST',
    token: authToken,
    body: {
      wallet_id: cashWallet.id,
      friend_name: 'Another Contact',
      amount: 5,
      category: 'Travel',
      lent_date: '2026-10-23'
    }
  });
  assert.equal(clearedLoan.status, 201);
  const clearResponse = await request('/api/khata/clear', { method: 'POST', token: authToken });
  assert.equal(clearResponse.status, 200);
  assert.deepEqual(await readBalances(), { cash: 92.75, online: 7.25 });
  const listResponse = await request('/api/khata', { token: authToken });
  assert.deepEqual((await listResponse.json()).records, []);
});

test('backup imports validate, merge idempotently, and restore an empty account snapshot', async () => {
  const resetResponse = await request('/api/reset', { method: 'POST', token: authToken });
  assert.equal(resetResponse.status, 200);
  assert.deepEqual(await readBalances(), { cash: 0, online: 0 });

  const invalidBackup = await request('/api/import', {
    method: 'POST',
    token: authToken,
    body: { currentCashBalance: 1, currentOnlineBalance: 0, transactions: [], unexpected: true }
  });
  assert.equal(invalidBackup.status, 400);

  const backup = {
    currentCashBalance: 100,
    currentOnlineBalance: 25,
    transactions: [{
      wallet: 'cash',
      type: 'expense',
      amount: 10,
      category: 'Imported food',
      date: '2026-10-20',
      note: 'Lunch'
    }],
    lentRecords: [{
      wallet: 'online',
      friendName: 'Imported Contact',
      amount: 5,
      category: 'Borrowed',
      date: '2026-10-21'
    }]
  };
  const importedResponse = await request('/api/import', {
    method: 'POST',
    token: authToken,
    body: backup
  });
  const imported = await importedResponse.json();
  assert.equal(importedResponse.status, 200);
  assert.equal(imported.restoredWalletBalances, true);
  assert.equal(imported.importedTransactions, 1);
  assert.equal(imported.importedLentRecords, 1);
  assert.deepEqual(await readBalances(), { cash: 100, online: 25 });

  const repeatedResponse = await request('/api/import', {
    method: 'POST',
    token: authToken,
    body: backup
  });
  const repeated = await repeatedResponse.json();
  assert.equal(repeatedResponse.status, 200);
  assert.equal(repeated.skippedTransactions, 1);
  assert.equal(repeated.skippedLentRecords, 1);
  assert.deepEqual(await readBalances(), { cash: 100, online: 25 });

  const mergedResponse = await request('/api/import', {
    method: 'POST',
    token: authToken,
    body: {
      currentCashBalance: 0,
      currentOnlineBalance: 0,
      transactions: [{
        wallet: 'cash',
        type: 'income',
        amount: 12,
        category: 'Imported salary',
        date: '2026-10-22'
      }]
    }
  });
  const merged = await mergedResponse.json();
  assert.equal(mergedResponse.status, 200);
  assert.equal(merged.restoredWalletBalances, false);
  assert.deepEqual(await readBalances(), { cash: 112, online: 25 });
});

test('logout revokes the current session', async () => {
  const response = await request('/api/logout', {
    method: 'POST',
    token: authToken
  });

  assert.equal(response.status, 204);

  const profileResponse = await request('/api/me', { token: authToken });
  assert.equal(profileResponse.status, 401);
});

test('login rate limiting blocks further attempts for a single email', async () => {
  const limitedEmail = `rate-limit-${process.pid}@example.com`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request('/api/login', {
      method: 'POST',
      body: { email: limitedEmail, password: incorrectPassword }
    });
    assert.equal(response.status, 401);
  }

  const blockedResponse = await request('/api/login', {
    method: 'POST',
    body: { email: limitedEmail, password: incorrectPassword }
  });
  assert.equal(blockedResponse.status, 429);
  assert.ok(Number(blockedResponse.headers.get('retry-after')) > 0);
});

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }

  try {
    await db.ready;
    await new Promise((resolve, reject) => {
      db.db.close(error => error ? reject(error) : resolve());
    });
  } finally {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const file = `${process.env.SPENDLY_DB_PATH}${suffix}`;
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        console.error(`Could not remove temporary test file ${file}: ${error.message}`);
      }
    }

    try {
      fs.rmSync(testDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Could not remove temporary test directory: ${error.message}`);
    }
  }
});
