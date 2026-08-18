const MAX_HISTORY = 20;

function rows(result) {
  return result?.results || [];
}

export function createRepository(db) {
  return {
    async findExistingUsername(nickname) {
      return Boolean(await db.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname).first());
    },

    async findUserByNickname(nickname) {
      return db.prepare('SELECT id, nickname, password_hash FROM users WHERE nickname = ?').bind(nickname).first();
    },

    async findUserById(id) {
      return db.prepare('SELECT id, nickname FROM users WHERE id = ?').bind(id).first();
    },

    async getApiKey(userId) {
      const user = await db.prepare('SELECT api_key FROM users WHERE id = ?').bind(userId).first();
      return (user?.api_key || '').trim();
    },

    async setApiKey(userId, apiKey) {
      await db.prepare('UPDATE users SET api_key = ? WHERE id = ?').bind(apiKey, userId).run();
    },

    async clearApiKey(userId) {
      await db.prepare('UPDATE users SET api_key = NULL WHERE id = ?').bind(userId).run();
    },

    async createUser(nickname, passwordHash, createdAt) {
      const result = await db.prepare(
        'INSERT INTO users (nickname, password_hash, created_at) VALUES (?, ?, ?)',
      ).bind(nickname, passwordHash, createdAt).run();
      return Number(result.meta?.last_row_id);
    },

    async createSession(token, userId, createdAt) {
      await db.prepare(
        'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)',
      ).bind(token, userId, createdAt).run();
    },

    async findSessionUser(token) {
      return db.prepare('SELECT user_id FROM sessions WHERE token = ?').bind(token).first();
    },

    async deleteSession(token) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    },

    async listHistory(userId) {
      const result = await db.prepare(
        'SELECT id, preview, date, data FROM history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      ).bind(userId, MAX_HISTORY).all();
      return rows(result).map((item) => {
        let data = {};
        try { data = JSON.parse(item.data); } catch {}
        return { id: item.id, preview: item.preview, date: item.date, data };
      });
    },

    async saveHistory(userId, preview, date, data, createdAt) {
      await db.prepare('DELETE FROM history WHERE user_id = ? AND preview = ?').bind(userId, preview).run();
      await db.prepare(
        'INSERT INTO history (user_id, preview, date, data, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(userId, preview, date, JSON.stringify(data || {}), createdAt).run();

      const result = await db.prepare(
        'SELECT id FROM history WHERE user_id = ? ORDER BY created_at DESC, id DESC',
      ).bind(userId).all();
      const oldRows = rows(result).slice(MAX_HISTORY);
      await Promise.all(oldRows.map(({ id }) => (
        db.prepare('DELETE FROM history WHERE id = ?').bind(id).run()
      )));
    },

    async deleteHistory(id, userId) {
      await db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').bind(id, userId).run();
    },
  };
}
