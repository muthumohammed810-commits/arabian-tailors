export const FIREBASE_ADMIN_APP_NAME = 'arabian-tailors-fcm-wif';
export const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

const TEAM_SLUG = 'muthumohammed810-5526s-projects';
const PROJECT_SLUG = 'arabian-tailors';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

/** Read non-secret WIF settings and fail closed if Firebase and Google projects differ. */
export function getFirebaseWifConfiguration(env) {
  const config = {
    projectId: typeof env?.GCP_PROJECT_ID === 'string' ? env.GCP_PROJECT_ID.trim() : '',
    projectNumber: typeof env?.GCP_PROJECT_NUMBER === 'string' ? env.GCP_PROJECT_NUMBER.trim() : '',
    poolId: typeof env?.GCP_WORKLOAD_IDENTITY_POOL_ID === 'string' ? env.GCP_WORKLOAD_IDENTITY_POOL_ID.trim() : '',
    providerId: typeof env?.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID === 'string' ? env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID.trim() : '',
    serviceAccountEmail: typeof env?.GCP_SERVICE_ACCOUNT_EMAIL === 'string' ? env.GCP_SERVICE_ACCOUNT_EMAIL.trim() : '',
  };
  const firebaseProjectId = typeof env?.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'string'
    ? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID.trim()
    : '';

  if (!validId(config.projectId) || !/^\d{6,20}$/.test(config.projectNumber)
    || !validId(config.poolId) || !validId(config.providerId)
    || config.projectId !== firebaseProjectId
    || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.iam\.gserviceaccount\.com$/.test(config.serviceAccountEmail)) return null;

  return { ...config, teamSlug: TEAM_SLUG, projectSlug: PROJECT_SLUG };
}

/** Build Google's external-account configuration; the Vercel token itself is supplied lazily. */
export function createFirebaseExternalAccountOptions(config, getSubjectToken) {
  if (!config || typeof getSubjectToken !== 'function') throw new TypeError('Firebase Workload Identity configuration is invalid.');
  return {
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken },
  };
}

function safeHttpStatus(error) {
  const candidates = [error?.response?.status, error?.status, error?.statusCode];
  for (const value of candidates) {
    const status = typeof value === 'number' ? value : typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : NaN;
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function stageForAuthError(error, fallback) {
  const url = error?.response?.config?.url || error?.config?.url || error?.response?.url;
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'sts.googleapis.com' && parsed.pathname === '/v1/token') return 'google-sts-exchange';
      if (parsed.hostname === 'iamcredentials.googleapis.com' && parsed.pathname.includes(':generateAccessToken')) return 'service-account-impersonation';
    } catch { /* Do not include malformed provider data in diagnostic output. */ }
  }
  return fallback;
}

/** Adapt Google's external-account client to Firebase Admin's public Credential interface. */
export function createFirebaseWifCredential(authClient, getFailureStage = () => 'google-authentication') {
  if (!authClient || typeof authClient.getAccessToken !== 'function') throw new TypeError('Google Workload Identity client is unavailable.');
  authClient.scopes = [FIREBASE_MESSAGING_SCOPE];
  return {
    async getAccessToken() {
      try {
        const response = await authClient.getAccessToken();
        const accessToken = response?.token || authClient.credentials?.access_token;
        const expiryDate = authClient.credentials?.expiry_date;
        if (typeof accessToken !== 'string' || !accessToken || typeof expiryDate !== 'number' || !Number.isFinite(expiryDate)) {
          throw new Error('Credential response is incomplete.');
        }
        return { access_token: accessToken, expires_in: Math.max(0, Math.floor((expiryDate - Date.now()) / 1000)) };
      } catch (error) {
        // Keep provider responses, tokens, and credential details out of application errors and logs.
        const fallbackStage = typeof getFailureStage === 'function' ? getFailureStage() : 'google-authentication';
        throw Object.assign(new Error('Google Cloud Workload Identity authentication failed.'), {
          code: 'firebase/wif-auth-failed',
          diagnosticStage: stageForAuthError(error, fallbackStage),
          diagnosticHttpStatus: safeHttpStatus(error),
        });
      }
    },
  };
}

/** Run a token-exchange-only diagnostic; never returns or logs the issued access token. */
export async function diagnoseFirebaseWifAuthentication({ env, getSubjectToken, ExternalAccountClient }) {
  const config = getFirebaseWifConfiguration(env);
  if (!config) return { ok: false, stage: 'configuration', httpStatus: 503, message: 'WIF configuration is missing or invalid.' };

  let stage = 'vercel-oidc';
  try {
    const externalOptions = createFirebaseExternalAccountOptions(config, async () => {
      stage = 'vercel-oidc';
      const token = await getSubjectToken({ team: config.teamSlug, project: config.projectSlug });
      if (typeof token !== 'string' || token.length < 100 || token.length > 16_384) throw new Error('Vercel OIDC token unavailable.');
      stage = 'google-authentication';
      return token;
    });
    const authClient = ExternalAccountClient.fromJSON(externalOptions);
    if (!authClient) return { ok: false, stage: 'configuration', httpStatus: 503, message: 'Google external-account configuration could not be initialized.' };
    const credential = createFirebaseWifCredential(authClient, () => stage);
    const result = await credential.getAccessToken();
    // Deliberately discard token material immediately; only confirm issuance.
    if (!result?.access_token) return { ok: false, stage: 'google-authentication', httpStatus: 503, message: 'Google did not issue an access token.' };
    return { ok: true, stage: 'service-account-impersonation', httpStatus: 200, message: 'Google access token issued successfully; no notification was sent.' };
  } catch (error) {
    const details = error && typeof error === 'object' ? error : {};
    const safeStage = ['vercel-oidc', 'google-authentication', 'google-sts-exchange', 'service-account-impersonation'].includes(details.diagnosticStage)
      ? details.diagnosticStage
      : stage;
    const providerStatus = Number.isInteger(details.diagnosticHttpStatus) && details.diagnosticHttpStatus >= 100 && details.diagnosticHttpStatus <= 599
      ? details.diagnosticHttpStatus
      : safeHttpStatus(error);
    const httpStatus = providerStatus || 503;
    const message = safeStage === 'vercel-oidc'
      ? 'Vercel could not provide an OIDC token in this request context.'
      : safeStage === 'google-sts-exchange'
        ? 'Google Security Token Service rejected or could not process the identity exchange.'
        : safeStage === 'service-account-impersonation'
          ? 'Google IAM could not impersonate the configured service account.'
          : 'Google Workload Identity authentication failed.';
    return { ok: false, stage: safeStage, httpStatus, message };
  }
}

/** Initialize only when called from a server request path; never call this at module scope. */
export function initializeFirebaseWifApp({ env, getSubjectToken, ExternalAccountClient, getApps, initializeApp }) {
  const config = getFirebaseWifConfiguration(env);
  if (!config) return null;
  const existing = getApps().find(app => app.name === FIREBASE_ADMIN_APP_NAME);
  if (existing) return existing;

  const externalOptions = createFirebaseExternalAccountOptions(config, async () => {
    const token = await getSubjectToken({ team: config.teamSlug, project: config.projectSlug });
    if (typeof token !== 'string' || token.length < 100 || token.length > 16_384) {
      throw new Error('Vercel OIDC token is unavailable.');
    }
    return token;
  });
  const authClient = ExternalAccountClient.fromJSON(externalOptions);
  if (!authClient) return null;
  const credential = createFirebaseWifCredential(authClient);
  return initializeApp({ credential, projectId: config.projectId }, FIREBASE_ADMIN_APP_NAME);
}
