/**
 * Google Ads API client — REST + GAQL.
 * Enhanced with retries, rate-limit handling, and token refresh.
 */

import type { GoogleAdsConfig } from "../config.js";

const API_VERSION = "v23";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleAdsClientError extends Error {
  statusCode: number;
  requestId?: string;
  retryAfter?: number;

  constructor(statusCode: number, message: string, requestId?: string, retryAfter?: number) {
    super(message);
    this.name = "GoogleAdsClientError";
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

export class GoogleAdsClient {
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private retryCount = 3;
  private retryDelay = 1000;

  constructor(private config: GoogleAdsConfig) {}

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`OAuth token refresh failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      "developer-token": this.config.developerToken,
      "login-customer-id": this.config.loginCustomerId,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        const res = await fetch(url, init);
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        const requestId = res.headers.get("x-request-id") ?? undefined;

        // Handle rate limiting
        if (res.status === 429) {
          const waitTime = retryAfter ? retryAfter * 1000 : this.retryDelay * Math.pow(2, attempt);
          console.error(`[GAds] Rate limited. Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
          continue;
        }

        if (!res.ok) {
          const text = await res.text();
          throw new GoogleAdsClientError(
            res.status,
            `Google Ads API ${res.status}: ${text.slice(0, 500)}`,
            requestId,
            retryAfter
          );
        }

        return (await res.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors
        if (
          lastError instanceof GoogleAdsClientError &&
          (lastError.statusCode === 401 || lastError.statusCode === 403)
        ) {
          throw lastError;
        }

        if (attempt < this.retryCount - 1) {
          const waitTime = this.retryDelay * Math.pow(2, attempt);
          console.error(`[GAds] Request failed, retrying in ${waitTime}ms...`);
          await this.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error("Google Ads request failed after retries");
  }

  async query<T = unknown>(gaql: string): Promise<T[]> {
    const data = await this.request<{ results?: T[] }>(
      `${BASE_URL}/customers/${this.config.customerId}/googleAds:search`,
      {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify({ query: gaql }),
      }
    );
    return data.results ?? [];
  }

  async searchFields(gaql: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ results?: Record<string, unknown>[] }>(
      `${BASE_URL}/customers/${this.config.customerId}/googleAdsFields:search`,
      {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify({ query: gaql }),
      }
    );
    return data.results ?? [];
  }

  async mutate(operations: unknown[]): Promise<unknown> {
    return this.request<unknown>(`${BASE_URL}/customers/${this.config.customerId}/googleAds:mutate`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ mutateOperations: operations }),
    });
  }

  get customerId(): string {
    return this.config.customerId;
  }
}
