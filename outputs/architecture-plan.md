# ARABIAN TAILORS — Architecture and Delivery Plan

## Product architecture

**Chosen stack:** Next.js App Router + React + TypeScript; Tailwind CSS with reusable design tokens; PostgreSQL + Prisma; Auth.js for customer/staff identity; object storage behind a signed-upload service; Razorpay or another RBI-compliant gateway behind a server-side payment adapter; transactional email provider and WhatsApp Business API behind notification adapters. Deploy the web app and background worker separately, with managed PostgreSQL, object storage/CDN, and scheduled encrypted backups.

**Why this stack:** one typed application can serve SEO-friendly storefront pages and protected admin routes, while server actions/API handlers keep price, stock, authorization, and payment decisions on the server. PostgreSQL supports relational tailoring configurations and immutable order snapshots. Provider adapters avoid coupling the domain to a payment, mail, messaging, or storage vendor.

## Logical boundaries

- `storefront`: home, search/catalog, product details, account, saved designs, cart, checkout, order tracking.
- `tailoring`: style/fabric/quality/color/measurement configuration, server-validated quote, saved design, immutable order configuration.
- `catalog`: products, variants, categories, media, stock and availability.
- `commerce`: cart, coupons, address/PIN validation, order lifecycle, cancellation policy, invoice.
- `identity`: customer authentication, verified email, roles, permissions, staff 2FA and sessions.
- `admin`: dashboard, catalog and tailoring configuration, orders, content, promotions, reports and audit trail.
- `integrations`: payment gateway, courier, email, WhatsApp, cloud media and analytics adapters.
- `shared`: validation schemas, INR money helpers, localization, UI primitives, observability.

The server is authoritative for quote calculation, coupon eligibility, stock reservation, role checks, payment state transitions and order writes. Treat browser prices and client-side validation as display/input only.

## Data model (core)

`User`, `Role`, `Permission`, `UserRole`, `RolePermission`; `Category`; `Product`, `ProductImage`, `ProductVariant`, `Inventory`; `KanduraStyle`, `Fabric`, `FabricQuality`, `Colour`, `MeasurementField`, `StyleMeasurementField`; `SavedDesign`, `DesignMeasurement`; `Address`; `Coupon`, `CouponProduct`, `CouponCategory`; `Order`, `OrderItem`, `OrderAddressSnapshot`, `TailoringSnapshot`, `OrderStatusEvent`; `Payment`, `Review`, `WishlistItem`; `Banner`, `HomepageSection`; `NotificationTemplate`, `NotificationAttempt`; `Invoice`, `AuditLog`, `BackupRecord`.

Use UUID identifiers, foreign keys, unique constraints, indexes for catalog/search/order filters, soft deactivation for configurable catalog entities, and audit events for sensitive admin writes. Store rupee amounts as integer paise (or Decimal with explicit scale). On order creation, copy product/fabric/tailoring/urgent/discount/delivery/tax totals, names, selected options, measurements, notes and policy version into immutable snapshots. Historical orders never join live prices to render totals.

## Key flows and invariants

1. **Custom design:** style → available fabric + quality → active colour → standard size or style-specific measurements → normal/urgent → quote → review. Save designs to the account. Quote from one shared server module; return a line-item breakdown and quote expiry/version. Validate units and sensible configurable bounds without arbitrarily rejecting legitimate tailoring measurements.
2. **Order/payment:** re-quote and recheck availability inside a transaction; reserve limited variant inventory atomically; create pending order and payment intent; redirect/launch gateway; accept only verified, idempotent signed webhooks as payment truth; confirm order only after success. A failed/expired payment releases reservation. Never begin tailoring before verified payment.
3. **Locking/status:** custom configuration and cancellation lock at order placement, with the restriction shown before confirmation. Status transitions are permission checked and audited. Custom statuses: Confirmed → Tailoring Started → Stitching → Ready, then shared delivery statuses. Standard cancellation window is configurable.
4. **Authorization:** server-side permission checks on every admin mutation/API, not UI visibility. Super Admin full access; Manager scoped business operations; Staff order viewing/processing only. Enforce staff 2FA and rate-limited authentication.
5. **Content:** homepage sections, banners, featured collections and metadata are database-managed with schedule, enabled state and sort order.

## Delivery phases

- **0 — Foundation (current):** architecture, visual tokens, responsive storefront shell, product discovery, client-side guided configurator as an interaction prototype, accessible states and seeded illustrative catalog.
- **1 — Domain and persistence:** Prisma schema/migrations, seed catalog, server quote/pricing service, validation, saved designs and configuration admin CRUD.
- **2 — Accounts and commerce:** verified auth, addresses, cart, coupon rules, atomic stock reservation, pending orders and immutable snapshots.
- **3 — Payments and fulfilment:** gateway adapter/webhooks, payment reconciliation, email/WhatsApp templates, courier tracking, cancellation rules, invoices.
- **4 — Operations:** permissioned admin, dashboards, inventory alerts, reports/exports, audit log, content management and backup/restore runbooks.
- **5 — Launch quality:** automated unit/integration/e2e and accessibility checks, security review, SEO structured data/sitemaps, performance budgets, monitoring and production deployment configuration.

## Configuration required from the business

Database and deployment credentials; auth/session secret and email sender; payment-gateway merchant/KYC approval and webhook secret; cloud image-storage credentials; WhatsApp Business account/template approvals; courier account/API details; legal business/address/GST and return/privacy/terms wording; domain and analytics consent configuration. Use environment variables or provider secret stores only. No secret or business registration data is fabricated here.

## First-phase boundary

The initial UI will demonstrate discovery and a transparent custom-Kandura configuration journey with sample prices. It does not create persistent accounts/orders, reserve stock or accept payment; those are intentionally enabled only after the corresponding server and provider phases are implemented.

