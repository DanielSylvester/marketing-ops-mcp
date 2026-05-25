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

function envWithFallback(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback
}

export const META_API_VERSION = process.env['META_API_VERSION'] ?? 'v25.0'
export const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`

// ---------------------------------------------------------------------------
// Dynamic Meta brand discovery
// ---------------------------------------------------------------------------

function discoverBrands(): Brand[] {
  // Explicit list takes precedence
  const explicit = envOptional('META_BRANDS')
  if (explicit) {
    return explicit.split(',').map(b => b.trim().toLowerCase()).filter(Boolean)
  }

  // Fallback: auto-discover from legacy env var names
  const brands: Brand[] = []
  if (envOptional('META_SMARTWORKS_TOKEN')) brands.push('smartworks')
  if (envOptional('META_WORKSTUDIO_TOKEN')) brands.push('workstudio')
  return brands
}

function buildMetaAccount(brand: Brand): MetaAccountConfig {
  const prefix = `META_${brand.toUpperCase()}`

  // Legacy fallback keys for smartworks / workstudio
  const legacyTokenKey = brand === 'smartworks' ? 'META_SMARTWORKS_TOKEN'
    : brand === 'workstudio' ? 'META_WORKSTUDIO_TOKEN'
    : undefined
  const legacyAccountKey = brand === 'smartworks' ? 'META_SMARTWORKS_ACCOUNT_ID'
    : brand === 'workstudio' ? 'META_WORKSTUDIO_ACCOUNT_ID'
    : undefined

  const token = envOptional(`${prefix}_TOKEN`) ?? (legacyTokenKey ? envOptional(legacyTokenKey) : undefined)
  if (!token) {
    throw new Error(`Missing token for brand '${brand}'. Set ${prefix}_TOKEN (or legacy ${legacyTokenKey}).`)
  }

  const accountId = envOptional(`${prefix}_ACCOUNT_ID`) ?? (legacyAccountKey ? envOptional(legacyAccountKey) : undefined) ?? ''
  // Defaults that match the legacy hardcoded config for backward compatibility
  const defaultCurrency = brand === 'workstudio' ? 'SGD' : 'INR'
  const defaultTimezone = brand === 'workstudio' ? 'Asia/Singapore' : 'Asia/Kolkata'
  const defaultPrefix = brand === 'smartworks' ? 'SW_' : brand === 'workstudio' ? 'WS_' : brand.slice(0, 2).toUpperCase() + '_'
  const defaultName = brand === 'smartworks' ? 'Smartworks India' : brand === 'workstudio' ? 'Workstudio Singapore' : brand

  const currency = envWithFallback(`${prefix}_CURRENCY`, defaultCurrency).toUpperCase()
  const timezone = envWithFallback(`${prefix}_TIMEZONE`, defaultTimezone)
  const campaignPrefix = envWithFallback(`${prefix}_PREFIX`, defaultPrefix)
  const name = envWithFallback(`${prefix}_NAME`, defaultName)

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
