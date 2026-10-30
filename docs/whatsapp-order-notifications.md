# WhatsApp order notifications

This integration uses Meta's WhatsApp Business Platform Cloud API from the server after the private order Blob write has succeeded. The browser never receives the access token. Message delivery is best-effort and cannot roll back an order.

## Server-only environment configuration

Configure these in the existing Vercel project for each environment that should send messages. Do not put values in `NEXT_PUBLIC_*` variables or source control.

- `WHATSAPP_ACCESS_TOKEN`: a long-lived/system-user token with `whatsapp_business_messaging` access for the configured number.
- `WHATSAPP_PHONE_NUMBER_ID`: the sender's Meta Phone Number ID (digits only).
- `WHATSAPP_API_VERSION`: a currently supported Graph API version in the form `vNN.0`.
- `WHATSAPP_CUSTOMER_TEMPLATE_NAME` and `WHATSAPP_CUSTOMER_TEMPLATE_LANGUAGE`: approved customer utility template.
- `WHATSAPP_OWNER_PHONE_NUMBER`: owner recipient in E.164 format, such as `+919876543210`.
- `WHATSAPP_OWNER_TEMPLATE_NAME` and `WHATSAPP_OWNER_TEMPLATE_LANGUAGE`: approved owner alert utility template. These are separate because the owner alert has different content and needs its own approved parameter contract.

The number must be registered for the WhatsApp Business Platform and belong to the configured business account. Meta must approve the templates before use. Business-initiated messages use templates; the implementation does not send free-form text.

## Template body parameter contract

Create templates whose body placeholders appear in precisely this order:

Customer confirmation (`WHATSAPP_CUSTOMER_TEMPLATE_NAME`, six text parameters):

1. Order number
2. Customer name
3. Product/model and selected customization summary
4. Total in INR
5. Delivery address summary
6. Current order and payment status (for example, `New / Pending verification`)

Owner order alert (`WHATSAPP_OWNER_TEMPLATE_NAME`, ten text parameters):

1. Order number
2. Customer name
3. Customer phone
4. Customer email
5. Product/model and selected customization summary
6. Total in INR
7. Payment status
8. Order status
9. Delivery address summary
10. Admin order link (`/admin?orderId=...`, which still requires Admin login)

Example customer body: `Hello {{2}}, we received order {{1}}. Items: {{3}}. Total: {{4}}. Delivery: {{5}}. Current status: {{6}}.`

Example owner body: `New order {{1}}. Customer: {{2}}, phone {{3}}, email {{4}}. Items: {{5}}. Total: {{6}}. Payment: {{7}}. Order status: {{8}}. Delivery: {{9}}. Open the order in Admin: {{10}}.`

Use an approved Utility category template and the language code that exactly matches the approved template. Any mismatch causes a safe failed notification status; the order remains saved.

## Consent, status, and verification limits

- Customer notifications are sent only after the customer checks the optional WhatsApp updates consent and enters a phone number in E.164 format.
- This project does not have phone ownership OTP verification. E.164 validation checks format only; it does not prove that the customer controls the number. If the shop requires verified ownership, add a separate OTP verification service before enabling customer sends.
- Owner alerts do not depend on customer opt-in and use the configured owner number and approved owner template.
- The stored `sent` state means Meta returned a message ID and accepted the request; delivery/read receipts are not integrated. A timeout, network loss, 5xx, or accepted response without a message ID is `unknown` and is not automatically retried, because Meta may already have accepted it.
- A durable private Blob claim prevents concurrent sends for the same order/channel. Known rejected sends can be retried from Admin. An interrupted `sending` state must be checked in Meta WhatsApp Manager before manually resolving it.
- API error records contain only safe Meta error codes and HTTP status. Access tokens, response bodies, recipient phone numbers, and message contents are not logged as errors.

## Admin

Open the order in Admin → Orders. The WhatsApp notification section shows customer and owner state, attempts, timestamps, and safe error codes. Failed/unconfigured/pending notifications can be explicitly retried. Sent, in-flight, and uncertain outcomes cannot be retried from the button to reduce duplicate messages.

## Custom reference photo orders

When an Abaya or Kandura order includes a valid private, order-scoped customer reference photo, the server labels it `Custom Reference Photo Order`. The UPI request is ₹500 only and remains pending until Admin verifies the advance in the merchant UPI app. The saved catalog amount is shown as an estimate; it is not treated as the final stitching price. The customer template parameters include the pending ₹500 advance and the design-review/final-price follow-up note. The owner template identifies the custom-reference order and includes customer contact and the Admin deep link. Admin sets and explicitly confirms the all-in final order total (including the saved delivery fee); the remaining balance is displayed only after both that confirmation and verified advance payment.

For custom-order templates, use the same six and ten placeholder order above, but phrase the amount/status placeholders so they read as an advance due and pending review rather than a settled final price. No real Meta message is sent by tests.
