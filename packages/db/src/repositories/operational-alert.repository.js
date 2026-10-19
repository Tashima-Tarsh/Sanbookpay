import crypto from 'node:crypto';

/**
 * Operational Alert Repository
 * Tracks real-time operations, latency targets, provider outages, and exceptions.
 */
export class OperationalAlertRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO operational_alerts (
        id, severity, category, title, message, metadata, is_acknowledged
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const params = [
      id,
      data.severity || 'INFO',
      data.category || 'SYSTEM',
      data.title,
      data.message,
      typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata || {}),
      data.isAcknowledged ? 1 : 0
    ];
    this.db.execute(sql, params);
    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM operational_alerts WHERE id = $1`, [id]);
  }

  listActive(category = null) {
    let sql = `SELECT * FROM operational_alerts WHERE is_acknowledged = 0`;
    const params = [];
    if (category) {
      sql += ` AND category = $1`;
      params.push(category);
    }
    sql += ` ORDER BY created_at DESC LIMIT 50`;
    return this.db.query(sql, params);
  }

  acknowledge(id) {
    this.db.execute(`UPDATE operational_alerts SET is_acknowledged = 1 WHERE id = $1`, [id]);
    return true;
  }
}

