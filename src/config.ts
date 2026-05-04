/**
 * Config loading. Each user supplies their own tokens via env vars (.env locally,
 * or however they want — this server reads from process.env).
 *
 * Account context is hardcoded here so calls can use brand names ('smartworks',
 * 'workstudio') instead of opaque numeric IDs.
 */

export type Brand = 'smartworks' | 'workstudio'

export interface MetaAccountConfig {
  brand: Brand
  name: string
  accountId: string          // act_<numeric>
  accessToken: string
  currency: 'INR' | 'SGD'
  currencySymbol: '₹' | 'S$'
  timezone: string
  campaignPrefix: 'SW_' | 'WS_'
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

const META_ACCOUNTS: Partial<Record<Brand, () => MetaAccountConfig>> = {
  smartworks: () => ({
    brand: 'smartworks',
    name: 'Smartworks India',
    accountId: process.env['META_SMARTWORKS_ACCOUNT_ID'] ?? 'act_796980188188098',
    accessToken: envOrThrow('META_SMARTWORKS_TOKEN'),
    currency: 'INR',
    currencySymbol: '₹',
    timezone: 'Asia/Kolkata',
    campaignPrefix: 'SW_',
  }),
  workstudio: () => ({
    brand: 'workstudio',
    name: 'Workstudio Singapore',
    accountId: process.env['META_WORKSTUDIO_ACCOUNT_ID'] ?? 'act_399862518529760',
    accessToken: envOrThrow('META_WORKSTUDIO_TOKEN'),
    currency: 'SGD',
    currencySymbol: 'S$',
    timezone: 'Asia/Singapore',
    campaignPrefix: 'WS_',
  }),
}

export function getMetaAccount(brand: Brand): MetaAccountConfig {
  const factory = META_ACCOUNTS[brand]
  if (!factory) throw new Error(`Unknown brand: ${brand}`)
  return factory()
}

export function listConfiguredMetaBrands(): Brand[] {
  const brands: Brand[] = []
  if (envOptional('META_SMARTWORKS_TOKEN')) brands.push('smartworks')
  if (envOptional('META_WORKSTUDIO_TOKEN')) brands.push('workstudio')
  return brands
}

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
