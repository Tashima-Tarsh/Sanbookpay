import crypto from 'node:crypto';

/**
 * Beneficiary Repository
 * Manages bank accounts and UPI IDs for outbound disbursements / payouts.
 */
export class BeneficiaryRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO beneficiaries (
        id, merchant_id, beneficiary_type, name, email, phone,
        bank_account, ifsc, upi_id, provider_bene_id, verification_status,
        verified_name, verification_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;
    const params = [
      id,
      data.merchantId,
      data.beneficiaryType || 'BANK_ACCOUNT',
      data.name,
      data.email || null,
      data.phone || null,
      data.bankAccount || null,
      data.ifsc || null,
      data.upiId || null,
      data.providerBeneId || null,
      data.verificationStatus || 'UNVERIFIED',
      data.verifiedName || null,
      data.verificationSource || null
    ];
    this.db.execute(sql, params);
    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM beneficiaries WHERE id = $1`, [id]);
  }

  findByMerchantId(merchantId) {
    return this.db.query(
      `SELECT * FROM beneficiaries WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [merchantId]
    );
  }

  findByProviderBeneId(merchantId, providerBeneId) {
    return this.db.queryOne(
      `SELECT * FROM beneficiaries WHERE merchant_id = $1 AND provider_bene_id = $2`,
      [merchantId, providerBeneId]
    );
  }

  update(id, data) {
    const fields = [];
    const params = [];
    let idx = 1;

    const map = {
      name: 'name',
      email: 'email',
      phone: 'phone',
      bankAccount: 'bank_account',
      ifsc: 'ifsc',
      upiId: 'upi_id',
      providerBeneId: 'provider_bene_id',
      verificationStatus: 'verification_status',
      verifiedName: 'verified_name',
      verificationSource: 'verification_source'
    };

    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        params.push(data[key]);
      }
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    const sql = `UPDATE beneficiaries SET ${fields.join(', ')} WHERE id = $${idx}`;
    this.db.execute(sql, params);
    return this.findById(id);
  }

  updateVerification(id, status, verifiedName = null, source = null) {
    const sql = `
      UPDATE beneficiaries 
      SET verification_status = $1, verified_name = $2, verification_source = $3, updated_at = datetime('now')
      WHERE id = $4
    `;
    this.db.execute(sql, [status, verifiedName, source, id]);
    return this.findById(id);
  }
}

