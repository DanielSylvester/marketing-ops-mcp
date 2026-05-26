/**
 * LinkedIn Marketing API client.
 * Ported from the standalone linkedin-ads-mcp server.
 * Enhanced with retries, rate-limit handling, batch fetching, and RestLi support.
 */

import { LinkedInApiError } from "../errors.js";

const LINKEDIN_API_BASE = "https://api.linkedin.com/rest";

const DEFAULT_PERFORMANCE_METRICS = [
  "impressions",
  "clicks",
  "landingPageClicks",
  "totalEngagements",
  "costInUsd",
  "costInLocalCurrency",
  "externalWebsiteConversions",
  "approximateUniqueImpressions",
  "averageDwellTime",
  "audiencePenetration",
];

const DEFAULT_CREATIVE_METRICS = [
  ...DEFAULT_PERFORMANCE_METRICS,
  "likes",
  "comments",
  "shares",
  "reactions",
  "follows",
];

const VIDEO_METRICS = [
  "videoViews",
  "videoStarts",
  "videoCompletions",
  "videoFirstQuartileCompletions",
  "videoMidpointCompletions",
  "videoThirdQuartileCompletions",
];

const LEAD_GEN_METRICS = ["oneClickLeads", "oneClickLeadFormOpens", "qualifiedLeads"];

const REACH_METRICS = ["approximateMemberReach", "impressions", "audiencePenetration"];

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, string | string[] | number | boolean | undefined>;
  restliMethod?:
    | "FINDER"
    | "BATCH_GET"
    | "GET"
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "PARTIAL_UPDATE"
    | "BATCH_PARTIAL_UPDATE"
    | "BATCH_CREATE";
  rawResponse?: boolean;
}

export interface LinkedInConfig {
  accessToken: string;
  apiVersion: string;
}

export class LinkedInClient {
  private config: LinkedInConfig;
  private retryCount = 3;
  private retryDelay = 1000;

  constructor(config: LinkedInConfig) {
    this.config = config;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    let urlString = `${LINKEDIN_API_BASE}${endpoint}`;
    const queryParts: string[] = [];

    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            queryParts.push(
              `${key}=List(${value.map((v) => encodeURIComponent(v)).join(",")})`
            );
          } else if (key === "fields" || key === "dateRange") {
            queryParts.push(`${key}=${value}`);
          } else {
            queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
          }
        }
      }
    }

    if (queryParts.length > 0) {
      urlString += "?" + queryParts.join("&");
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      "LinkedIn-Version": this.config.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
    };

    if (options.restliMethod) {
      headers["X-RestLi-Method"] = options.restliMethod;
    }

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        const response = await fetch(urlString, {
          method: options.method || "GET",
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const requestId = response.headers.get("x-linkedin-request-id") ?? undefined;
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

        if (response.status === 429) {
          const waitTime = retryAfter
            ? retryAfter * 1000
            : this.retryDelay * Math.pow(2, attempt);
          console.error(`[LinkedIn] Rate limited. Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new LinkedInApiError(
            response.status,
            `LinkedIn API error: ${response.status} ${response.statusText}`,
            errorText,
            requestId,
            retryAfter
          );
        }

        if (options.rawResponse) {
          return response as unknown as T;
        }

        const contentLength = response.headers.get("content-length");
        if (response.status === 204 || response.status === 201 || contentLength === "0") {
          const restliId = response.headers.get("x-restli-id");
          if (restliId) {
            return { id: restliId } as T;
          }
          return {} as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (
          lastError instanceof LinkedInApiError &&
          (lastError.statusCode === 401 || lastError.statusCode === 403)
        ) {
          throw lastError;
        }

        if (attempt < this.retryCount - 1) {
          const waitTime = this.retryDelay * Math.pow(2, attempt);
          console.error(`[LinkedIn] Request failed, retrying in ${waitTime}ms...`);
          await this.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error("LinkedIn request failed after retries");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get<T>(path: string, params?: RequestOptions["params"]): Promise<T> {
    return this.request<T>(path, { method: "GET", params });
  }

  async post<T>(path: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">): Promise<T> {
    return this.request<T>(path, { method: "POST", body, ...options });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PUT", body });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>(path, { method: "DELETE" });
  }

  formatDateRange(startDate: string, endDate?: string): string {
    const start = this.parseDate(startDate);
    const end = endDate ? this.parseDate(endDate) : this.parseDate(new Date().toISOString().split("T")[0]);
    return `(start:(year:${start.year},month:${start.month},day:${start.day}),end:(year:${end.year},month:${end.month},day:${end.day}))`;
  }

  private parseDate(dateStr: string): { year: number; month: number; day: number } {
    const [year, month, day] = dateStr.split("-").map(Number);
    return { year, month, day };
  }

  // ── Accounts ─────────────────────────────────────────────────────────────

  async listAdAccounts(options: { status?: string[]; type?: string; includeTest?: boolean } = {}) {
    const params: Record<string, string | string[]> = { q: "search" };
    if (options.status?.length) params["search.status.values"] = options.status;
    if (options.type) params["search.type.values"] = [options.type];

    const response = await this.get<{ elements?: Array<Record<string, unknown>> }>("/adAccounts", params);
    let accounts = response.elements || [];
    if (!options.includeTest) {
      accounts = accounts.filter((a) => !a.test);
    }
    return accounts;
  }

  async getAccountDetails(accountId: string) {
    return this.get<Record<string, unknown>>(`/adAccounts/${accountId}`);
  }

  // ── Campaign Groups ──────────────────────────────────────────────────────

  async listCampaignGroups(accountId: string, options: { status?: string[] } = {}) {
    const params: Record<string, string | string[]> = { q: "search" };
    if (options.status?.length) params["search.status.values"] = options.status;
    const response = await this.get<{ elements?: Array<Record<string, unknown>> }>(
      `/adAccounts/${accountId}/adCampaignGroups`,
      params
    );
    return response.elements || [];
  }

  async getCampaignGroup(accountId: string, campaignGroupId: string) {
    try {
      return await this.get<Record<string, unknown>>(`/adAccounts/${accountId}/adCampaignGroups/${campaignGroupId}`);
    } catch {
      return null;
    }
  }

  async createCampaignGroup(accountId: string, data: Record<string, unknown>) {
    return this.post<{ id: string }>(`/adAccounts/${accountId}/adCampaignGroups`, {
      account: `urn:li:sponsoredAccount:${accountId}`,
      ...data,
    });
  }

  async updateCampaignGroup(accountId: string, campaignGroupId: string, updates: Record<string, unknown>) {
    await this.post<void>(`/adAccounts/${accountId}/adCampaignGroups/${campaignGroupId}`, {
      patch: { $set: updates },
    }, { restliMethod: "PARTIAL_UPDATE" });
  }

  async deleteCampaignGroup(accountId: string, campaignGroupId: string, isDraft: boolean) {
    if (isDraft) {
      await this.delete(`/adAccounts/${accountId}/adCampaignGroups/${campaignGroupId}`);
    } else {
      await this.updateCampaignGroup(accountId, campaignGroupId, { status: "PENDING_DELETION" });
    }
  }

  // ── Campaigns ────────────────────────────────────────────────────────────

  async listCampaigns(accountId: string, options: { campaignGroupIds?: string[]; status?: string[] } = {}) {
    const params: Record<string, string | string[]> = { q: "search" };
    if (options.campaignGroupIds?.length) {
      params["search.campaignGroup.values"] = options.campaignGroupIds.map(
        (id) => `urn:li:sponsoredCampaignGroup:${id}`
      );
    }
    if (options.status?.length) params["search.status.values"] = options.status;
    const response = await this.get<{ elements?: Array<Record<string, unknown>> }>(
      `/adAccounts/${accountId}/adCampaigns`,
      params
    );
    return response.elements || [];
  }

  async getCampaign(accountId: string, campaignId: string) {
    try {
      return await this.get<Record<string, unknown>>(`/adAccounts/${accountId}/adCampaigns/${campaignId}`);
    } catch {
      return null;
    }
  }

  async getCampaignsByIds(accountId: string, campaignIds: string[]) {
    const map = new Map<string, Record<string, unknown>>();
    const batchSize = 10;
    for (let i = 0; i < campaignIds.length; i += batchSize) {
      const batch = campaignIds.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((id) => this.getCampaign(accountId, id)));
      results.forEach((campaign, idx) => {
        if (campaign) map.set(batch[idx], campaign);
      });
    }
    return map;
  }

  async createCampaign(accountId: string, data: Record<string, unknown>) {
    const body = { account: `urn:li:sponsoredAccount:${accountId}`, ...data };
    return this.post<{ id: string }>(`/adAccounts/${accountId}/adCampaigns`, body);
  }

  async updateCampaign(accountId: string, campaignId: string, updates: Record<string, unknown>) {
    await this.post<void>(`/adAccounts/${accountId}/adCampaigns/${campaignId}`, {
      patch: { $set: updates },
    }, { restliMethod: "PARTIAL_UPDATE" });
  }

  async deleteCampaign(accountId: string, campaignId: string, isDraft: boolean) {
    if (isDraft) {
      await this.delete(`/adAccounts/${accountId}/adCampaigns/${campaignId}`);
    } else {
      await this.updateCampaign(accountId, campaignId, { status: "PENDING_DELETION" });
    }
  }

  // ── Creatives ────────────────────────────────────────────────────────────

  async listCreatives(accountId: string, options: { campaignIds?: string[]; creativeIds?: string[]; pageSize?: number } = {}) {
    const params: Record<string, string | string[]> = {
      q: "criteria",
      pageSize: String(options.pageSize ?? 100),
    };
    if (options.campaignIds?.length) {
      params.campaigns = options.campaignIds.map((id) => `urn:li:sponsoredCampaign:${id}`);
    }
    if (options.creativeIds?.length) {
      params.creatives = options.creativeIds.map((id) => `urn:li:sponsoredCreative:${id}`);
    }
    const response = await this.request<{ elements?: Array<Record<string, unknown>> }>(
      `/adAccounts/${accountId}/creatives`,
      { params, restliMethod: "FINDER" }
    );
    return response.elements || [];
  }

  async getCreative(accountId: string, creativeId: string) {
    try {
      const encodedId = encodeURIComponent(
        creativeId.startsWith("urn:") ? creativeId : `urn:li:sponsoredCreative:${creativeId}`
      );
      return await this.get<Record<string, unknown>>(`/adAccounts/${accountId}/creatives/${encodedId}`);
    } catch {
      return null;
    }
  }

  async getCreativesByIds(accountId: string, creativeIds: string[]) {
    const map = new Map<string, Record<string, unknown>>();
    const batchSize = 50;
    for (let i = 0; i < creativeIds.length; i += batchSize) {
      const batch = creativeIds.slice(i, i + batchSize);
      try {
        const creatives = await this.listCreatives(accountId, { creativeIds: batch, pageSize: 100 });
        for (const creative of creatives) {
          const idMatch = (creative.id as string)?.match(/urn:li:sponsoredCreative:(\d+)/);
          if (idMatch) map.set(idMatch[1], creative);
        }
      } catch {
        // silently skip failed batch
      }
    }
    return map;
  }

  async createCreative(accountId: string, data: Record<string, unknown>) {
    return this.post<{ id: string }>(`/adAccounts/${accountId}/creatives`, data);
  }

  async createInlineCreative(accountId: string, data: Record<string, unknown>) {
    return this.post<{ id: string }>(`/adAccounts/${accountId}/creatives?action=createInline`, {
      creative: data,
    });
  }

  async updateCreative(accountId: string, creativeId: string, updates: Record<string, unknown>) {
    const encodedId = encodeURIComponent(
      creativeId.startsWith("urn:") ? creativeId : `urn:li:sponsoredCreative:${creativeId}`
    );
    await this.post<void>(`/adAccounts/${accountId}/creatives/${encodedId}`, {
      patch: { $set: updates },
    }, { restliMethod: "PARTIAL_UPDATE" });
  }

  // ── Content Resolution ───────────────────────────────────────────────────

  async getPost(postUrn: string) {
    try {
      return await this.get<Record<string, unknown>>(`/posts/${encodeURIComponent(postUrn)}`);
    } catch {
      return null;
    }
  }

  async getImage(imageUrn: string) {
    try {
      return await this.get<Record<string, unknown>>(`/images/${encodeURIComponent(imageUrn)}`);
    } catch {
      return null;
    }
  }

  async getImagesBatch(imageUrns: string[]) {
    const map = new Map<string, string>();
    if (imageUrns.length === 0) return map;
    try {
      const encoded = imageUrns.map((u) => encodeURIComponent(u)).join(",");
      const response = await this.get<{ results?: Record<string, Record<string, unknown>> }>(
        `/images?ids=List(${encoded})`
      );
      if (response?.results) {
        for (const [urn, data] of Object.entries(response.results)) {
          if (data.downloadUrl) map.set(urn, data.downloadUrl as string);
        }
      }
    } catch {
      // silently fail
    }
    return map;
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  async getAnalytics(options: {
    accountId: string;
    pivot: string;
    startDate: string;
    endDate?: string;
    timeGranularity?: string;
    campaigns?: string[];
    campaignGroups?: string[];
    metrics?: string[];
  }) {
    const dateRange = this.formatDateRange(options.startDate, options.endDate);
    const metrics = options.metrics || DEFAULT_PERFORMANCE_METRICS;
    const fieldsToRequest = [...metrics, "pivotValues"];
    if (options.timeGranularity && options.timeGranularity !== "ALL") {
      fieldsToRequest.push("dateRange");
    }

    const params: Record<string, string | string[]> = {
      q: "analytics",
      pivot: options.pivot,
      dateRange,
      timeGranularity: options.timeGranularity || "ALL",
      accounts: [`urn:li:sponsoredAccount:${options.accountId}`],
      fields: fieldsToRequest.join(","),
    };

    if (options.campaigns?.length) {
      params.campaigns = options.campaigns.map((id) => `urn:li:sponsoredCampaign:${id}`);
    }
    if (options.campaignGroups?.length) {
      params.campaignGroups = options.campaignGroups.map((id) => `urn:li:sponsoredCampaignGroup:${id}`);
    }

    const response = await this.get<{ elements?: Array<Record<string, unknown>> }>("/adAnalytics", params);
    return response.elements || [];
  }

  async getCampaignPerformance(options: {
    accountId: string;
    campaignIds?: string[];
    campaignGroupIds?: string[];
    startDate: string;
    endDate?: string;
    timeGranularity?: string;
    metrics?: string[];
  }) {
    return this.getAnalytics({
      ...options,
      pivot: "CAMPAIGN",
      campaigns: options.campaignIds,
      campaignGroups: options.campaignGroupIds,
    });
  }

  async getCreativePerformance(options: {
    accountId: string;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
    timeGranularity?: string;
    includeVideoMetrics?: boolean;
  }) {
    let metrics = DEFAULT_CREATIVE_METRICS.filter((m) => m !== "audiencePenetration" && m !== "costInLocalCurrency");
    if (options.includeVideoMetrics !== false) {
      metrics = [...metrics, ...VIDEO_METRICS];
    }
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: "CREATIVE",
      startDate: options.startDate,
      endDate: options.endDate,
      timeGranularity: options.timeGranularity,
      campaigns: options.campaignIds,
      metrics,
    });
  }

  async getCampaignGroupPerformance(options: {
    accountId: string;
    startDate: string;
    endDate?: string;
    timeGranularity?: string;
  }) {
    return this.getAnalytics({ ...options, pivot: "CAMPAIGN_GROUP" });
  }

  async getAudienceDemographics(options: {
    accountId: string;
    demographicType: string;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
  }) {
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: options.demographicType,
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      metrics: [...DEFAULT_PERFORMANCE_METRICS, "totalEngagements"],
    });
  }

  async getAudienceReach(options: {
    accountId: string;
    campaignIds?: string[];
    campaignGroupIds?: string[];
    startDate: string;
    endDate?: string;
  }) {
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: options.campaignIds?.length ? "CAMPAIGN" : "ACCOUNT",
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      campaignGroups: options.campaignGroupIds,
      metrics: REACH_METRICS,
    });
  }

  async getLeadGenPerformance(options: {
    accountId: string;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
    timeGranularity?: string;
  }) {
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: "CAMPAIGN",
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      timeGranularity: options.timeGranularity,
      metrics: [...LEAD_GEN_METRICS, "costInUsd", "impressions", "clicks"],
    });
  }

  async getConversionPerformance(options: {
    accountId: string;
    campaignIds?: string[];
    startDate: string;
    endDate?: string;
    includePostView?: boolean;
    timeGranularity?: string;
  }) {
    const metrics = [
      "externalWebsiteConversions",
      "externalWebsitePostClickConversions",
      "costInUsd",
      "conversionValueInLocalCurrency",
    ];
    if (options.includePostView !== false) {
      metrics.push("externalWebsitePostViewConversions");
    }
    return this.getAnalytics({
      accountId: options.accountId,
      pivot: "CONVERSION",
      startDate: options.startDate,
      endDate: options.endDate,
      campaigns: options.campaignIds,
      timeGranularity: options.timeGranularity,
      metrics,
    });
  }

  // ── Conversions ──────────────────────────────────────────────────────────

  async listConversions(accountId: string, enabledOnly = false) {
    const params: Record<string, string> = {
      q: "account",
      account: `urn:li:sponsoredAccount:${accountId}`,
    };
    const response = await this.get<{ elements?: Array<Record<string, unknown>> }>("/conversions", params);
    let conversions = response.elements || [];
    if (enabledOnly) {
      conversions = conversions.filter((c) => c.enabled);
    }
    return conversions;
  }

  // ── Lead Gen ─────────────────────────────────────────────────────────────

  async listLeadForms(accountId: string, status?: string[]) {
    const params: Record<string, string | string[]> = {
      q: "owner",
      owner: `(sponsoredAccount:urn:li:sponsoredAccount:${accountId})`,
    };
    const response = await this.get<{ elements?: Array<Record<string, unknown>> }>("/leadForms", params);
    let forms = response.elements || [];
    if (status?.length) {
      forms = forms.filter((f) => status.includes(f.status as string));
    }
    return forms;
  }

  // ── Audiences ────────────────────────────────────────────────────────────

  async listSavedAudiences(accountId: string, options: { status?: string[]; type?: string } = {}) {
    const params: Record<string, string> = {
      q: "account",
      account: `urn:li:sponsoredAccount:${accountId}`,
    };
    const response = await this.get<{ elements?: Array<Record<string, unknown>> }>("/dmpSegments", params);
    let audiences = response.elements || [];
    if (options.status?.length) {
      audiences = audiences.filter((a) => options.status!.includes(a.status as string));
    }
    if (options.type) {
      audiences = audiences.filter((a) => a.type === options.type);
    }
    return audiences;
  }

  // ── Image Upload ─────────────────────────────────────────────────────────

  async uploadImage(data: { owner: string; filePath: string; accountId?: string; assetName?: string }) {
    const ownerUrn = data.owner.startsWith("urn:") ? data.owner : `urn:li:organization:${data.owner}`;

    const initBody: Record<string, unknown> = {
      initializeUploadRequest: { owner: ownerUrn },
    };

    if (data.accountId && data.assetName) {
      (initBody.initializeUploadRequest as Record<string, unknown>).mediaLibraryMetadata = {
        associatedAccount: `urn:li:sponsoredAccount:${data.accountId}`,
        assetName: data.assetName,
      };
    }

    const initResponse = await this.post<{
      value: { uploadUrl: string; image: string; uploadUrlExpiresAt: number };
    }>("/images?action=initializeUpload", initBody);

    const { uploadUrl, image: imageUrn } = initResponse.value;

    const fs = await import("node:fs");
    const path = await import("node:path");

    if (!fs.existsSync(data.filePath)) {
      throw new Error(`File not found: ${data.filePath}`);
    }

    const fileBuffer = fs.readFileSync(data.filePath);
    const ext = path.extname(data.filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": contentType,
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Image upload failed (${uploadResponse.status}): ${errorText}`);
    }

    return { imageUrn, uploadUrl };
  }
}
