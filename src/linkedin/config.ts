/**
 * LinkedIn Ads configuration.
 *
 * Reads from environment variables:
 *   LINKEDIN_ACCESS_TOKEN — required
 *   LINKEDIN_API_VERSION  — defaults to 202604
 */

export interface LinkedInConfig {
  accessToken: string;
  apiVersion: string;
}

export function getLinkedInConfig(): LinkedInConfig {
  const accessToken = process.env["LINKEDIN_ACCESS_TOKEN"] || "";
  const apiVersion = process.env["LINKEDIN_API_VERSION"] || "202604";
  if (!accessToken) {
    throw new Error("Missing LINKEDIN_ACCESS_TOKEN env var");
  }
  return { accessToken, apiVersion };
}

export function isLinkedInConfigured(): boolean {
  return !!process.env["LINKEDIN_ACCESS_TOKEN"];
}
