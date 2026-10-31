import crypto from 'node:crypto';

export class MfaRepository {
  constructor(db) {
    this.db = db;
  }

  createChallenge(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO mfa_challenges (id, user_type, user_id, secret_encrypted, is_verified, recovery_codes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.userType, data.userId, data.secretEncrypted, data.isVerified ? 1 : 0,
       data.recoveryCodes || '[]', now, now]
    );
    return this.findChallengeById(id);
  }

  findChallengeById(id) {
    const row = this.db.queryOne('SELECT * FROM mfa_challenges WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findChallengeByUser(userType, userId) {
    const row = this.db.queryOne(
      'SELECT * FROM mfa_challenges WHERE user_type = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userType, userId]
    );
    return row ? this.mapRow(row) : null;
  }

  updateChallenge(id, updates) {
    const fields = [];
    const params = [];
    const allowed = ['secret_encrypted', 'is_verified', 'recovery_codes'];
    const colMap = { secretEncrypted: 'secret_encrypted', isVerified: 'is_verified', recoveryCodes: 'recovery_codes' };
    for (const key of allowed) {
      const jsKey = Object.keys(colMap).find(k => colMap[k] === key) || key;
      if (updates[jsKey] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[jsKey]);
      }
    }
    if (fields.length === 0) return this.findChallengeById(id);
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    this.db.execute(`UPDATE mfa_challenges SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findChallengeById(id);
  }

  deleteChallenge(id) {
    this.db.execute('DELETE FROM mfa_challenges WHERE id = ?', [id]);
    return { success: true };
  }

  mapRow(row) {
    return {
      id: row.id,
      userType: row.user_type,
      userId: row.user_id,
      secretEncrypted: row.secret_encrypted,
      isVerified: Boolean(row.is_verified),
      recoveryCodes: row.recovery_codes,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
