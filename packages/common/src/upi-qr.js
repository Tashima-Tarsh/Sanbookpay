/**
 * NPCI-compliant UPI QR Code and Deep Link Generator.
 * Works with ALL UPI apps (Google Pay, PhonePe, Paytm, BHIM, etc.)
 * ZERO merchant account or bank approval required — just need a VPA.
 * All features are 100% free (Government of India mandates 0% MDR on UPI since 2020).
 */
import { generateQrSvg } from '@youpi/core';

/**
 * Builds a standard NPCI UPI payment URI.
 * Format: upi://pay?pa={vpa}&pn={name}&mc={merchantCode}&mode={mode}&tr={txnRef}&tn={note}&am={amount}&cu=INR
 *
 * @param {Object} params
 * @param {string} params.vpa - Payee VPA (e.g. merchant@upi)
 * @param {string} params.name - Payee name (max 100 chars)
 * @param {number} [params.amount] - Fixed amount in rupees (omitted = user enters amount)
 * @param {string} [params.orderId] - Transaction reference ID
 * @param {string} [params.note] - Transaction note/description
 * @param {'fixed'|'editable'} [params.mode='fixed'] - 'fixed' locks amount, 'editable' lets user change
 * @param {string} [params.merchantCode] - Merchant category code (optional)
 * @returns {string} UPI payment URI (e.g. upi://pay?pa=merchant@upi&pn=Store&mode=04&am=100.00&cu=INR&tr=ORD123)
 */
export function buildUpiPaymentUri({ vpa, name, amount, orderId, note = '', mode = 'fixed', merchantCode = '' }) {
  if (!vpa || typeof vpa !== 'string') throw new Error('VPA is required');
  if (!name || typeof name !== 'string') throw new Error('Payee name is required');

  const params = new URLSearchParams();
  params.set('pa', vpa.trim());
  params.set('pn', name.trim());
  if (merchantCode) params.set('mc', merchantCode.trim());
  // mode: 04 = fixed amount (user cannot edit), 02 = editable amount
  params.set('mode', mode === 'fixed' ? '04' : '02');
  if (orderId) params.set('tr', orderId.trim());
  if (note) params.set('tn', note.trim());
  if (amount !== undefined && amount !== null) {
    params.set('am', Number(amount).toFixed(2));
  }
  params.set('cu', 'INR');

  return `upi://pay?${params.toString()}`;
}

/**
 * Builds app-specific UPI deep links from a UPI URI.
 * These links open the payment directly in the respective UPI app.
 *
 * @param {string} upiUri - Full upi://pay URI from buildUpiPaymentUri()
 * @returns {Object} Map of app name → deep link URL
 */
export function buildUpiPaymentIntentLinks(upiUri) {
  if (!upiUri || !upiUri.startsWith('upi://pay?')) throw new Error('Invalid UPI URI');
  const query = upiUri.slice('upi://pay?'.length);

  return {
    phonepe: `phonepe://pay?${query}`,
    gpay: `tez://upi/pay?${query}`,
    paytm: `paytmmp://pay?${query}`,
    bhim: `upi://pay?${query}`,
    upi: upiUri // Generic fallback
  };
}

/**
 * Generates a base64 data URI SVG QR code from a UPI URI.
 * Can be embedded directly in <img src="data:image/svg+xml;base64,..." />.
 *
 * @param {string} upiUri - UPI payment URI
 * @param {number} [boxSize=400] - SVG size in pixels
 * @returns {string} data:image/svg+xml;base64,... data URI
 */
export function generateQrDataUri(upiUri, boxSize = 400) {
  if (!upiUri) throw new Error('UPI URI is required');
  const svg = generateQrSvg(upiUri, boxSize, 'M');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * Converts rupees to integer paise (avoids JS float bugs like 5.99 * 100 = 599.0000000000001).
 *
 * @param {number|string} rupees
 * @returns {number} Integer paise
 */
export function rupeesToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

/**
 * Converts integer paise to rupees string with 2 decimal places.
 *
 * @param {number|string} paise
 * @returns {string} Rupees string (e.g. '100.00')
 */
export function paiseToRupees(paise) {
  return (Number(paise) / 100).toFixed(2);
}
