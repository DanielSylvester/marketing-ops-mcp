import { META_BASE_URL, type MetaAccountConfig } from "../config.js";

interface MetaError {
  error: { message: string; type: string; code: number; fbtrace_id?: string };
}

export class MetaClientError extends Error {
  statusCode: number;
  fbTraceId?: string;
  retryAfter?: number;

  constructor(statusCode: number, message: string, fbTraceId?: string, retryAfter?: number) {
    super(message);
    this.name = "MetaClientError";
    this.statusCode = statusCode;
    this.fbTraceId = fbTraceId;
    this.retryAfter = retryAfter;
  }
}

export class MetaClient {
  private retryCount = 3;
  private retryDelay = 1000;

  constructor(private readonly account: MetaAccountConfig) {}

  get accountId(): string {
    return this.account.accountId;
  }
  get currency(): string {
    return this.account.currency;
  }
  get currencySymbol(): string {
    return this.account.currencySymbol;
  }

  private url(path: string): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${META_BASE_URL}${p}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | undefined> = {},
    body?: Record<string, unknown>
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        const url = new URL(this.url(path));
        url.searchParams.set("access_token", this.account.accessToken);
        for (const [k, v] of Object.entries(params)) {
          if (v === undefined || v === null) continue;
          url.searchParams.set(k, String(v));
        }

        const init: RequestInit = { method };
        if (method === "POST" && body) {
          const form = new URLSearchParams();
          for (const [k, v] of Object.entries(body)) {
            if (v === undefined || v === null) continue;
            form.set(k, typeof v === "string" ? v : JSON.stringify(v));
          }
          init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
          init.body = form.toString();
        }

        const res = await fetch(url.toString(), init);
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

        // Handle rate limiting
        if (res.status === 429) {
          const waitTime = retryAfter ? retryAfter * 1000 : this.retryDelay * Math.pow(2, attempt);
          console.error(`[Meta] Rate limited. Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
          continue;
        }

        const text = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new MetaClientError(res.status, `Meta API: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
        }

        if ((data as MetaError).error) {
          const e = (data as MetaError).error;
          throw new MetaClientError(
            res.status,
            `Meta API ${res.status}: ${e.message} (code=${e.code}${e.fbtrace_id ? ` trace=${e.fbtrace_id}` : ""})`,
            e.fbtrace_id,
            retryAfter
          );
        }

        return data as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors
        if (lastError instanceof MetaClientError && (lastError.statusCode === 401 || lastError.statusCode === 403)) {
          throw lastError;
        }

        if (attempt < this.retryCount - 1) {
          const waitTime = this.retryDelay * Math.pow(2, attempt);
          console.error(`[Meta] Request failed, retrying in ${waitTime}ms...`);
          await this.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error("Meta request failed after retries");
  }

  async get<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    return this.request<T>("GET", path, params);
  }

  async post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, {}, body);
  }

  // Pull all pages from a paginated endpoint up to maxPages.
  async getPaginated<T = unknown>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    maxPages = 5
  ): Promise<T[]> {
    const out: T[] = [];
    let nextUrl: string | null = null;
    let page = 0;
    while (page < maxPages) {
      const data: unknown = nextUrl
        ? await fetch(nextUrl).then((r) => r.json())
        : await this.get<unknown>(path, { ...params, limit: 100 });
      if (typeof data === "object" && data !== null && "error" in data) {
        const e = (data as Record<string, unknown>).error as { message?: string };
        throw new Error(`Meta API: ${e.message ?? "unknown error"}`);
      }
      const d = data as { data?: T[]; paging?: { next?: string } };
      out.push(...(d.data ?? []));
      nextUrl = d.paging?.next ?? null;
      if (!nextUrl) break;
      page++;
    }
    return out;
  }
}
