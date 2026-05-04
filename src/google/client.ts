/**
 * Google Ads API client — REST + GAQL.
 * Ported from adpilot/src/google-ads/client.ts so the same patterns apply.
 */

import type { GoogleAdsConfig } from '../config.js'

const API_VERSION = 'v23'
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export class GoogleAdsClient {
  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor(private config: GoogleAdsConfig) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) throw new Error(`OAuth token refresh failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return this.accessToken
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      'Authorization': `Bearer ${await this.getAccessToken()}`,
      'developer-token': this.config.developerToken,
      'login-customer-id': this.config.loginCustomerId,
      'Content-Type': 'application/json',
    }
  }

  async query<T = unknown>(gaql: string): Promise<T[]> {
    const res = await fetch(`${BASE_URL}/customers/${this.config.customerId}/googleAds:search`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ query: gaql }),
    })
    if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${await res.text()}`)
    const data = await res.json() as { results?: T[] }
    return data.results ?? []
  }

  async mutate(operations: unknown[]): Promise<unknown> {
    const res = await fetch(`${BASE_URL}/customers/${this.config.customerId}/googleAds:mutate`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ mutateOperations: operations }),
    })
    if (!res.ok) throw new Error(`Google Ads mutate ${res.status}: ${await res.text()}`)
    return res.json()
  }

  get customerId(): string { return this.config.customerId }
}
