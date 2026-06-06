/**
 * Config loading. Each user supplies their own tokens via env vars (.env locally,
 * or however they want — this server reads from process.env).
 *
 * Meta brands are fully dynamic: set META_BRANDS=comma,separated,list and then
 * META_<BRAND>_TOKEN, META_<BRAND>_ACCOUNT_ID, etc. for each one.
 *
 * Backward compatibility: if META_BRANDS is not set, we auto-discover from the
 * legacy META_SMARTWORKS_TOKEN and META_WORKSTUDIO_TOKEN env vars.
 */

export type Brand = string

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  SGD: 'S$',
  USD: '$',
  EUR: '€',
  GBP: '£',
}

export interface MetaAccountConfig {
  brand: Brand
  name: string
  accountId: string          // act_<numeric>
  accessToken: string
  currency: string
  currencySymbol: string
  timezone: string
  campaignPrefix: string
}

export interface GoogleAdsConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  developerToken: string
  loginCustomerId: string
  customerId: string
}

function envOrThrow(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Missing required env var: ${key}`)
  return v
}

function envOptional(key: string): string | undefined {
  return process.env[key] || undefined
}

export const META_API_VERSION = process.env['META_API_VERSION'] ?? 'v25.0'
export const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

// ---------------------------------------------------------------------------
// Dynamic Meta brand discovery
// ---------------------------------------------------------------------------

function discoverBrands(): Brand[] {
  const explicit = envOptional('META_BRANDS')
  if (!explicit) {
    throw new Error('META_BRANDS is required. Set as comma-separated list, e.g. META_BRANDS=brand-a,brand-b')
  }
  return explicit.split(',').map(b => b.trim().toLowerCase()).filter(Boolean)
}

function buildMetaAccount(brand: Brand): MetaAccountConfig {
  const prefix = `META_${brand.toUpperCase()}`

  const token = envOptional(`${prefix}_TOKEN`)
  if (!token) {
    throw new Error(`Missing token for brand '${brand}'. Set ${prefix}_TOKEN.`)
  }

  const accountId = envOptional(`${prefix}_ACCOUNT_ID`) ?? ''
  const currency = (envOptional(`${prefix}_CURRENCY`) ?? 'INR').toUpperCase()
  const timezone = envOptional(`${prefix}_TIMEZONE`) ?? 'UTC'
  const campaignPrefix = envOptional(`${prefix}_PREFIX`) ?? ''
  const name = envOptional(`${prefix}_NAME`) ?? brand

  return {
    brand,
    name,
    accountId,
    accessToken: token,
    currency,
    currencySymbol: CURRENCY_SYMBOLS[currency] ?? currency,
    timezone,
    campaignPrefix,
  }
}

const _metaAccounts = new Map<Brand, MetaAccountConfig>()

export function getMetaAccount(brand: Brand): MetaAccountConfig {
  const cached = _metaAccounts.get(brand)
  if (cached) return cached

  const config = buildMetaAccount(brand)
  _metaAccounts.set(brand, config)
  return config
}

export function listConfiguredMetaBrands(): Brand[] {
  return discoverBrands()
}

// ---------------------------------------------------------------------------
// Google Ads config (single account — still env-driven)
// ---------------------------------------------------------------------------

export function getGoogleAdsConfig(): GoogleAdsConfig {
  return {
    clientId: envOrThrow('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: envOrThrow('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: envOrThrow('GOOGLE_ADS_REFRESH_TOKEN'),
    developerToken: envOrThrow('GOOGLE_ADS_DEVELOPER_TOKEN'),
    loginCustomerId: envOrThrow('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
    customerId: envOrThrow('GOOGLE_ADS_CUSTOMER_ID'),
  }
}

export function isGoogleAdsConfigured(): boolean {
  return !!(envOptional('GOOGLE_ADS_CLIENT_ID') && envOptional('GOOGLE_ADS_REFRESH_TOKEN'))
}

// ---------------------------------------------------------------------------
// LinkedIn config passthrough
// ---------------------------------------------------------------------------

export { isLinkedInConfigured } from './linkedin/config.js'
