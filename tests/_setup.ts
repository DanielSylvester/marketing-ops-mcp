// Loaded via `node --import` before any test module so config.ts sees a
// complete dummy env. No real network calls are made.

const d = (k: string, v: string) => {
  if (!process.env[k]) process.env[k] = v
}

d('META_SMARTWORKS_TOKEN', 'test-sw-token')
d('META_WORKSTUDIO_TOKEN', 'test-ws-token')
d('GOOGLE_ADS_CLIENT_ID', 'test-client-id')
d('GOOGLE_ADS_CLIENT_SECRET', 'test-client-secret')
d('GOOGLE_ADS_REFRESH_TOKEN', 'test-refresh-token')
d('GOOGLE_ADS_DEVELOPER_TOKEN', 'test-dev-token')
d('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '1234567899')
d('GOOGLE_ADS_CUSTOMER_ID', '1234567890')
