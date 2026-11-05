# SANGIRA-HOSPITALITY-CLOUD

Sangira is a multi-tenant operations platform for hotels, restaurants, bars, and lounges. This repository contains the initial platform foundation and operational workflows for staff, inventory, and menu management.

## Technology

- Next.js App Router and React with TypeScript
- Supabase Auth and PostgreSQL
- PostgreSQL row-level security for tenant data

## Local setup

1. Install Node.js 20.9 or newer.
2. Install dependencies with `npm install`.
3. Create a Supabase project and copy `.env.example` to `.env.local`.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project URL and publishable (or legacy anon) key.
5. Apply the migrations in `supabase/migrations/` to the project using the Supabase CLI or SQL editor. To use the CLI, run `supabase login`, `supabase link --project-ref <project-ref>`, then `supabase db push`.
6. In Supabase Auth settings, configure the site URL and email confirmation behavior for local development.
7. Start the app with `npm run dev`.

The registration and dashboard routes require Supabase configuration and the migration. The home page remains available before Supabase is configured and explains the required setup.

For local Supabase development, run `supabase start` and `supabase db reset` (Docker is required). Use the local API URL and publishable/anon key printed by `supabase status` in `.env.local`.

### Bootstrap the first platform administrator

Create and confirm the administrator's account first. Then, in the Supabase SQL editor, assign the platform role using that account's actual UUID:

```sql
insert into public.platform_user_roles (user_id, role_key)
values ('YOUR_AUTH_USER_UUID', 'system_admin');
```

Only a trusted project administrator should run this SQL. There is intentionally no public self-service path for granting platform administrator access.

## Current implementation

- Email/password sign-up and sign-in use Supabase's server-side cookie session.
- Authenticated users can submit business applications and view their own applications.
- Platform administrators review applications through the `review_business_application` database function.
- Approval creates a business, settings, owner membership, initial departments, and an audit record atomically.
- Business managers can issue expiring, single-use employee invitation links with multiple roles and department assignments. Recipients must sign in with the invited, verified email. Links currently need to be shared manually; email delivery is not configured.
- The inventory phase adds supplier and product catalogs, central and department stock locations, batch/expiry tracking, receipts, idempotent stock movements, department requests, manager review, partial approval, actual issuance, adjustments, and wastage records.
- Business memberships and permission-based roles are enforced by row-level security and database functions.
- The menu catalog phase adds business-scoped categories and priced items, with one-serving recipes referencing the inventory catalog. Recipe quantities are consumed when a ticket moves to preparing (see the recipe consumption migration).
- Tenant-scoped tables use RLS; privileged database credentials are not used in browser code.

Apply the migrations in order before using the corresponding routes:

1. `supabase/migrations/20261104154500_platform_foundation.sql`
2. `supabase/migrations/20261104165000_staff_access.sql`
3. `supabase/migrations/20261104171600_inventory_operations.sql`
4. `supabase/migrations/20261104173000_menu_catalog.sql`
5. `supabase/migrations/20261104180000_orders_tickets.sql` (the menu page also needs this one, because it reads the item routing column)
6. `supabase/migrations/20261104183000_payments.sql`
7. `supabase/migrations/20261104190000_recipe_consumption.sql`
8. `supabase/migrations/20261104193000_business_reports.sql`
9. `supabase/migrations/20261104200000_attendance.sql`

10. `supabase/migrations/20261104210000_qr_ordering.sql`
11. `supabase/migrations/20261104213000_documents.sql`
12. `supabase/migrations/20261104220000_mobile_money_payments.sql`
13. `supabase/migrations/20261104230000_personal_settings.sql` (profile fields, preferences, private `sangira-avatars` bucket, account deletion requests; powers `/settings`)
14. `supabase/migrations/20261105100000_cancellation_refunds.sql`
15. `supabase/migrations/20261105103000_guest_self_service.sql`
16. `supabase/migrations/20261105110000_ticket_assignment.sql`
17. `supabase/migrations/20261105113000_cashier_controls.sql`
18. `supabase/migrations/20261105120000_purchasing.sql`
19. `supabase/migrations/20261105123000_manager_overview.sql`
20. `supabase/migrations/20261105130000_hotel_module.sql`
21. `supabase/migrations/20261105133000_hotel_extras.sql`
22. `supabase/migrations/20261105140000_public_menu_read_access.sql`
23. `supabase/migrations/20261105141000_business_discovery.sql`
24. `supabase/migrations/20261105150000_hotel_manager_scope.sql`
25. `supabase/migrations/20261105160000_restaurant_manager_role.sql`

Migrations are applied in timestamp order and never run automatically. Review pending changes with `supabase db push --dry-run` before applying them with `supabase db push`.

**Payments.** Cashiers record cash, card, and bank-transfer payments manually (verified by the cashier). MTN MoMo and Airtel Money payments are requested from the customer's phone and recorded only after the provider status API confirms success. Callbacks (`/api/payments/{mtn,airtel}/callback/[id]?sig=...`) carry an HMAC signature of our own and only trigger a status lookup. Refunds/reversals and escrow are not implemented: MTN collection refund support is unverified, and Airtel refund behaviour needs sandbox confirmation.

**Public discovery and QR ordering.** The home page shows a small set of approved, active businesses with a published menu. Search results are limited and fetched server-side. Selecting a business resolves its UUID to the existing public menu URL (`/m/<slug>`). Public profile and menu images use optional HTTPS URLs configured by business managers. QR ordering remains available at `/m/<slug>`; anonymous users can read the public menu, while guest order/session operations remain service-role protected.

**Documents.** Private `sangira-documents` bucket; uploads are validated (type by content, 10 MB max), isolated by business, and downloaded through 60-second signed URLs.

## Server environment

See `.env.example`. Required beyond the Supabase keys: `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_SESSION_SECRET`, `APP_BASE_URL`, `PAYMENT_CALLBACK_SECRET`, and the MTN / Airtel sandbox credentials for mobile money. Callbacks require a public HTTPS URL.
## Validation

```bash
npm run lint
npm run build
```
