# ARABIAN TAILORS

Luxury tailoring storefront for ARABIAN TAILORS — “Elegance, Tailored for You.”

## Stack

- Next.js App Router, React, TypeScript
- Tailwind CSS 4 with custom design tokens
- Private Vercel Blob JSON storage for store configuration, catalog and orders
- Vercel deployment target

## Local development

Requirements: Node.js 20.9+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Admin dashboard

The password-protected dashboard manages stored orders, customers derived from order delivery details, products/services, store appearance and manually reconciled payment status. Admin mutations are validated server-side. Customer removal deletes associated order records and requires typing the customer email. Payment status changes are restricted to pending payments reviewed by an admin; this app does not collect payments automatically.

## Deployment

Configure `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` and `BLOB_READ_WRITE_TOKEN` as server-side Vercel environment variables. Keep all three private and never commit their values. Connect a private Vercel Blob store to persist shared catalog, settings and order records.

The checkout can show UPI QR and bank transfer instructions configured in the admin. Transfers must be reconciled manually. For automatic card or UPI collection, connect a payment provider account and implement its private server-side keys and verified webhook flow. Never use `NEXT_PUBLIC_` for secrets.
