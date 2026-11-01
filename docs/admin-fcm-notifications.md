# Admin Firebase Cloud Messaging notifications

Admin push uses the Firebase Cloud Messaging Web SDK in each browser and the Firebase Admin SDK on the server. Each FCM registration token is stored as a private Vercel Blob record keyed by a SHA-256 digest. The raw token is never returned to the Admin UI, exposed in logs, or sent to another device. Records are associated with the existing authenticated shared Admin account because this project has a single shared Admin password/session. The order API attempts notifications only after the private order blob has been written. A push failure never rolls back an order; a durable order/device claim prevents duplicate alerts on request retries.

## Firebase and Google Cloud setup

1. Create or select the Firebase project `arabian-tailors`.
2. In Firebase Console → Project settings → General, register a Web app and configure its public Web settings in Vercel.
3. In Firebase Console → Project settings → Cloud Messaging, enable Firebase Cloud Messaging and create a Web Push certificate pair. Set the public key as `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
4. In the Google Cloud project `arabian-tailors`, enable the Firebase Cloud Messaging API, Security Token Service API, and IAM Service Account Credentials API.
5. Create a Workload Identity Pool with ID `arabian-tailors` and an OpenID Connect provider with ID `vercel-production`.
6. Configure the provider:
   - Issuer: `https://oidc.vercel.com/muthumohammed810-5526s-projects`
   - Allowed audience: `https://vercel.com/muthumohammed810-5526s-projects`
   - Attribute mappings: `google.subject=assertion.sub`, `attribute.owner_id=assertion.owner_id`, `attribute.project_id=assertion.project_id`, and `attribute.environment=assertion.environment`.
   - Attribute condition: require the confirmed Vercel team ID, Arabian Tailors project ID, and `assertion.environment == 'production'`. Obtain the numeric team and project IDs from Vercel; do not use guessed IDs. The provider must reject Preview and Development identities.
7. Create the dedicated service account `arabian-tailors-fcm@arabian-tailors.iam.gserviceaccount.com`.
8. Grant that service account a custom role containing only `cloudmessaging.messages.create` on the Firebase project. This permission is supported in custom roles. If the organization disallows custom roles, `roles/firebasecloudmessaging.admin` is Google's predefined FCM sending role but grants additional FCM permissions.
9. Grant only the production federated subject the `roles/iam.workloadIdentityUser` role on that service account. The subject should be `owner:muthumohammed810-5526s-projects:project:arabian-tailors:environment:production`, after confirming the project name claim in Vercel. Do not bind the entire pool.
10. In the existing Vercel project, enable OIDC with the Team issuer. Configure the GCP identifiers below for **Production only**. No service-account key or `FIREBASE_SERVICE_ACCOUNT_JSON` is used.

## Vercel environment variables

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web app configuration; public client value. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Web app configuration; public client value. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase target project ID; must match `GCP_PROJECT_ID`. |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Web app configuration; public client value. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Web app configuration; public client value. |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Public Web Push certificate key used by Firebase `getToken`. |
| `GCP_PROJECT_ID` | `arabian-tailors`; non-secret Google Cloud project identifier. |
| `GCP_PROJECT_NUMBER` | `735989185164`; non-secret project number used in the WIF provider resource name. |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | `arabian-tailors`; non-secret pool identifier. |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | `vercel-production`; non-secret provider identifier. |
| `GCP_SERVICE_ACCOUNT_EMAIL` | Dedicated service-account email; identifier, not a private key. |
| `BLOB_READ_WRITE_TOKEN` | Existing private Vercel Blob persistence token; unchanged. |

The provider's allowed audience is the Vercel team audience above. The Google external-account audience used internally is constructed from the project number, pool ID, and provider ID. They are different values. The server obtains the short-lived Vercel subject token at request time through `@vercel/oidc`, exchanges it with Google STS, then impersonates the dedicated service account through IAM Credentials. The Firebase Admin SDK receives only short-lived access tokens through its server-side credential interface. No private key is generated, stored, or required.

Vercel OIDC is available on all Vercel plans. The Google provider condition and service-account binding must still be configured correctly. Local development does not receive production authorization; use mocks for tests. Do not add a production identity to Preview or Development to make local testing work.

The public Firebase web config and Web Push public key are not service credentials. Never place OIDC tokens or Google access tokens in client code, logs, or persistent storage. `FIREBASE_SERVICE_ACCOUNT_JSON` is no longer read by the application and should be removed from Vercel only after the OIDC deployment has been verified.

Changing Firebase project/VAPID settings requires each Admin device to register again. The dynamic `/firebase-messaging-sw.js` route returns only public Web config and is not Admin-protected so the browser service worker can initialize; no server credential fields are returned by that route.

## Enable each device

1. Deploy after Firebase, Google Cloud WIF, and Vercel Production OIDC settings are configured.
2. Sign in to `/admin` on an Admin device and open **Push Notifications**.
3. Click **Enable notifications on this device** and grant browser permission. Permission is not requested before the click.
4. Use **Send test** on that device. Repeat on each phone/browser profile; each gets its own hashed device record.
5. **Disable this device** removes the current token from private storage and Firebase. Admin can remove stale devices from the device list.

Order notifications contain only the order reference and a generic new-order message. They do not include customer phone/address, payment details, or private uploaded photos. Delivery status means FCM accepted or rejected the send; it cannot prove the operating system displayed the alert.

## Test without an order or payment

Use **Send test** beside a registered device. This sends a test FCM message directly; it does not create an order, touch payment records, or send WhatsApp. A real end-to-end test requires configured Firebase/Vercel environment and an Admin browser/device with notification permission.

## Browser support and iOS

Use HTTPS and a supported browser with service-worker and Push API support. Browser/OS notification settings, battery restrictions, network status, and Focus/Do Not Disturb can delay or suppress display.

For iOS/iPadOS, add the site to the Home Screen and open the installed web app before enabling notifications. Apple web push is supported on Home Screen web apps starting with iOS/iPadOS 16.4; the user must grant permission, and OS notification settings still apply. FCM/browser availability can vary by browser and OS version, so use the in-dashboard test on each target device.
