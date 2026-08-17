import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/repository.js';

function createFakeDb() {
  const state = {
    users: [],
    sessions: [],
    history: [],
    nextUserId: 1,
    nextHistoryId: 1,
  };

  return {
    state,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('SELECT id FROM users WHERE nickname')) {
                return state.users.find((user) => user.nickname === args[0]) || null;
              }
              if (sql.includes('SELECT id, nickname, password_hash')) {
                const user = state.users.find((item) => item.nickname === args[0]);
                return user ? { id: user.id, nickname: user.nickname, password_hash: user.password_hash } : null;
              }
              if (sql.includes('SELECT user_id FROM sessions')) {
                const session = state.sessions.find((item) => item.token === args[0]);
                return session ? { user_id: session.user_id } : null;
              }
              return null;
            },
            async all() {
              if (sql.includes('SELECT id, preview, date, data FROM history')) {
                return {
                  results: state.history
                    .filter((item) => item.user_id === args[0])
                    .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
                    .slice(0, args[1]),
                };
              }
              if (sql.includes('SELECT id FROM history WHERE user_id')) {
                return {
                  results: state.history
                    .filter((item) => item.user_id === args[0])
                    .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
                    .map(({ id }) => ({ id })),
                };
              }
              return { results: [] };
            },
            async run() {
              if (sql.startsWith('INSERT INTO users')) {
                const user = {
                  id: state.nextUserId++,
                  nickname: args[0],
                  password_hash: args[1],
                  created_at: args[2],
                };
                state.users.push(user);
                return { meta: { last_row_id: user.id } };
              }
              if (sql.startsWith('INSERT INTO sessions')) {
                state.sessions.push({ token: args[0], user_id: args[1], created_at: args[2] });
                return { meta: {} };
              }
              if (sql.startsWith('DELETE FROM sessions')) {
                state.sessions = state.sessions.filter((item) => item.token !== args[0]);
                return { meta: {} };
              }
              if (sql.startsWith('DELETE FROM history WHERE user_id = ? AND preview')) {
                state.history = state.history.filter((item) => !(item.user_id === args[0] && item.preview === args[1]));
                return { meta: {} };
              }
              if (sql.startsWith('INSERT INTO history')) {
                state.history.push({
                  id: state.nextHistoryId++, user_id: args[0], preview: args[1], date: args[2], data: args[3], created_at: args[4],
                });
                return { meta: {} };
              }
              if (sql.startsWith('DELETE FROM history WHERE id')) {
                state.history = state.history.filter((item) => item.id !== args[0]);
                return { meta: {} };
              }
              return { meta: {} };
            },
          };
        },
      };
    },
  };
}

test('creates a user and session, then reads the session user', async () => {
  const db = createFakeDb();
  const repository = createRepository(db);

  const userId = await repository.createUser('tester', 'hash', '2026-08-17T00:00:00.000Z');
  await repository.createSession('token', userId, 1);

  assert.equal(await repository.findExistingUsername('tester'), true);
  assert.deepEqual(await repository.findUserByNickname('tester'), {
    id: userId,
    nickname: 'tester',
    password_hash: 'hash',
  });
  assert.equal((await repository.findSessionUser('token')).user_id, userId);
});

test('deduplicates history and retains only the newest 20 items', async () => {
  const db = createFakeDb();
  const repository = createRepository(db);

  for (let index = 0; index < 21; index += 1) {
    await repository.saveHistory(1, `preview-${index}`, 'today', { index }, index);
  }
  await repository.saveHistory(1, 'preview-20', 'updated', { updated: true }, 100);

  const history = await repository.listHistory(1);
  assert.equal(history.length, 20);
  assert.equal(history[0].preview, 'preview-20');
  assert.deepEqual(history[0].data, { updated: true });
});
