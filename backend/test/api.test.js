
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Configure the isolated test environment BEFORE importing the app or database.
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spendly-test-'));
process.env.SPENDLY_DB_PATH = path.join(testDirectory, 'spendly-test.db');
process.env.JWT_SECRET = 'spendly-test-secret-key-at-least-32-bytes-long';
process.env.BCRYPT_ROUNDS = '10';
process.env.NODE_ENV = 'test';

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
      password: 'TestPassword123!'
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
      password: 'TestPassword123!'
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
      password: 'TestPassword123!'
    }
  });

  assert.equal(response.status, 409);
});

test('login rejects an incorrect password', async () => {
  const response = await request('/api/login', {
    method: 'POST',
    body: {
      email: testEmail,
      password: 'WrongPassword123!'
    }
  });

  assert.equal(response.status, 401);
});

test('login accepts valid credentials', async () => {
  const response = await request('/api/login', {
    method: 'POST',
    body: {
      email: testEmail,
      password: 'TestPassword123!'
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

test('logout revokes the current session', async () => {
  const response = await request('/api/logout', {
    method: 'POST',
    token: authToken
  });

  assert.equal(response.status, 204);

  const profileResponse = await request('/api/me', { token: authToken });
  assert.equal(profileResponse.status, 401);
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
