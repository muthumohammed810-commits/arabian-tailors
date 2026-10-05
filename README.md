# ARABIAN TAILORS

Luxury tailoring storefront foundation for ARABIAN TAILORS — “Elegance, Tailored for You.”

## Stack

- Next.js App Router, React, TypeScript
- Tailwind CSS 4 with custom design tokens
- PostgreSQL + Prisma planned for persistence
- Vercel deployment target

## Local development

Requirements: Node.js 20.9+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Current scope

The storefront and guided Kandura configurator are a UI foundation with illustrative catalog and prices. It does not yet persist accounts or orders, process payment, reserve inventory, or provide a production admin dashboard. See [the architecture plan](outputs/architecture-plan.md) for the phased delivery plan and business configuration required.

## Deployment

Vercel can build this repository using its Next.js preset and the `pnpm build` script. Configure Git integration after importing the repository. No secrets are needed for the current UI-only routes. Add database, authentication, payment, storage and notification environment variables only when those integrations are implemented.

