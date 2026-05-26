export class LinkedInApiError extends Error {
  statusCode: number;
  responseBody?: unknown;
  requestId?: string;
  retryAfter?: number;

  constructor(
    statusCode: number,
    message: string,
    responseBody?: unknown,
    requestId?: string,
    retryAfter?: number
  ) {
    super(message);
    this.name = "LinkedInApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

export class McpToolError extends Error {
  code: string;
  isError: true;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.isError = true;
  }
}
