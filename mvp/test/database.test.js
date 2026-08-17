const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { initializeDatabase } = require('../database');

test('initializes every table required by registration and history', () => {
  const db = new DatabaseSync(':memory:');

  initializeDatabase(db);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'));

  assert.deepEqual(tables, ['history', 'sessions', 'users']);
  db.prepare(
    'INSERT INTO users (nickname, password_hash, created_at) VALUES (?, ?, ?)',
  ).run('tester', 'hash', '2026-08-17T00:00:00.000Z');
});
