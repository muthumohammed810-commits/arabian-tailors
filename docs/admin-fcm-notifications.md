# Admin Firebase Cloud Messaging alerts

Admin push uses the Firebase Cloud Messaging Web SDK in each browser and the Firebase Admin SDK on the server. Each FCM registration token is stored as a private Vercel Blob record keyed by a SHA-256 digest. The raw token is never returned to the Admin UI, exposed in logs, or sent to another device. Records are associated with the existing authenticated shared Admin account because this project has a single shared Admin password/session. The order API attempts notifications only after the private order blob has been written. A push failure never rolls back an order; a durable order/device claim prevents duplicate alerts on request retries.

## Firebase setup

1. Create or select a Firebase project for Arabian Tailors.
2. In Firebase Console → Project settings → General, register a Web app and copy its public Web configuration values.
3. In Firebase Console → Project settings → Cloud Messaging, enable the Firebase Cloud Messaging API and create a Web Push certificate pair. Use its public key for `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
4. In Google Cloud IAM for that Firebase project, create a service account allowed to send Firebase Cloud Messaging messages (Firebase Cloud Messaging API Admin). Create a service-account JSON key only if a workload identity is not available.
5. Configure these Vercel environment variables for each deployment environment. Do not commit the service-account JSON or paste it into chat/logs.

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web app config; public client value. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Web app config; public client value. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase target project ID. Must match the service-account project. |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Web app config; public client value. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Web app config; public client value. |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Public Web Push certificate key used by Firebase `getToken`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full service-account JSON string. Server-only; never use a `NEXT_PUBLIC_` name. |
| `BLOB_READ_WRITE_TOKEN` | Existing private Vercel Blob persistence token; unchanged. |

The public Firebase web config and Web Push public key are not service credentials. The service-account private key is secret. Changing Firebase project/VAPID settings requires each Admin device to register again. The dynamic `/firebase-messaging-sw.js` route returns only public Web config and is not Admin-protected so the browser service worker can initialize; no service-account fields are returned by that route.

## Enable each device

1. Deploy after Firebase and Blob settings are configured.
2. Sign in to `/admin` on an Admin device and open **Push Notifications**.
3. Click **Enable notifications on this device** and grant the browser permission. Permission is not requested before the click.
4. Use **Send test** on that device. Repeat steps 2–4 on each phone/browser profile; each gets its own hashed device record.
5. **Disable this device** removes the current token from private storage and Firebase. Admin can remove stale devices from the device list.

Order notifications contain only the order reference and a generic new-order message. They do not include customer phone/address, payment details, or private uploaded photos. Delivery status means FCM accepted or rejected the send; it cannot prove the operating system displayed the alert.

## Test without an order or payment

Use **Send test** beside a registered device. This sends a test FCM message directly; it does not create an order, touch payment records, or send WhatsApp. A real end-to-end test requires configured Firebase/Vercel environment and an Admin browser/device with notification permission.

## Browser support and iOS

Use HTTPS and a supported browser with service-worker and Push API support (current Android Chrome and desktop Chrome/Edge/Firefox/Safari). Browser/OS notification settings, battery restrictions, network status, and Focus/Do Not Disturb can delay or suppress display.

For iOS/iPadOS, add the site to the Home Screen and open the installed web app before enabling notifications. Apple web push is supported on Home Screen web apps starting with iOS/iPadOS 16.4; the user must grant permission, and OS notification settings still apply. FCM/browser availability can vary by browser and OS version, so use the in-dashboard test on each target device.
