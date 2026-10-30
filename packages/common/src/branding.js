/**
 * Sanbook Pay — Central Product Branding & Configuration
 * Authoritative constants for Sanbook Pay FinTech platform.
 */

export const PRODUCT_NAME = 'Sanbook Pay';
export const PRODUCT_SLUG = 'sanbook-pay';
export const APP_ID = 'sanbook-pay';
export const DASHBOARD_TITLE = 'Sanbook Pay Merchant Console';
export const CHECKOUT_TITLE = 'Sanbook Pay Secure Checkout';
export const API_DISPLAY_NAME = 'Sanbook Pay API';
export const RECEIPT_BRAND = 'Sanbook Pay';

export const SanbookPayConfig = Object.freeze({
  productName: PRODUCT_NAME,
  slug: PRODUCT_SLUG,
  appId: APP_ID,
  dashboardTitle: DASHBOARD_TITLE,
  checkoutTitle: CHECKOUT_TITLE,
  apiDisplayName: API_DISPLAY_NAME,
  receiptBrand: RECEIPT_BRAND,
  defaultSupportEmail: process.env.SUPPORT_EMAIL || 'support@sanbookpay.com',
  defaultPrimaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#059669', // Emerald accent
  darkNavyBg: '#0f172a',
  whiteBg: '#ffffff',
  headerTheme: 'dark',
  customDomain: process.env.SANBOOK_PAY_DOMAIN || process.env.YOUPI_DOMAIN || null,
  companyName: process.env.COMPANY_NAME || 'Sanbook Technologies Private Limited',
  logoUrl: process.env.DEFAULT_LOGO_URL || null,
  version: '2.0.0-production'
});

export const DefaultBranding = Object.freeze({
  appName: PRODUCT_NAME,
  primaryColor: SanbookPayConfig.defaultPrimaryColor,
  logoUrl: null
});

// Legacy backward-compatibility alias
export const LegacyDefaultBranding = Object.freeze({
  appName: 'YOUPI PG',
  primaryColor: '#2563eb',
  logoUrl: null
});

