// Loaded via `node --import` before any test module so config.ts sees a
// complete dummy env. No real network calls are made.

const d = (k: string, v: string) => {
  if (!process.env[k]) process.env[k] = v;
};

// Generic test brands — no client-specific names in code
d("META_BRANDS", "acme,globex");
d("META_ACME_TOKEN", "test-acme-token");
d("META_GLOBEX_TOKEN", "test-globex-token");
d("META_ACME_ACCOUNT_ID", "act_111111111111111");
d("META_GLOBEX_ACCOUNT_ID", "act_222222222222222");
d("META_ACME_CURRENCY", "USD");
d("META_GLOBEX_CURRENCY", "EUR");
d("META_ACME_TIMEZONE", "America/New_York");
d("META_GLOBEX_TIMEZONE", "Europe/London");
d("META_ACME_PREFIX", "AC_");
d("META_GLOBEX_PREFIX", "GL_");
d("GOOGLE_ADS_CLIENT_ID", "test-client-id");
d("GOOGLE_ADS_CLIENT_SECRET", "test-client-secret");
d("GOOGLE_ADS_REFRESH_TOKEN", "test-refresh-token");
d("GOOGLE_ADS_DEVELOPER_TOKEN", "test-dev-token");
d("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "1234567899");
d("GOOGLE_ADS_CUSTOMER_ID", "1234567890");
