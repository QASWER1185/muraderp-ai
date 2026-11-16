# Rickshaw Trips

Open /#/rickshaw-trips for the driver master, fast trip entry, daily driver summary and payouts. Dates default to the Karachi calendar date in the API. The daily summary includes opening due, that day's trips and payments, and cumulative due through the selected date.

Trip entry represents carriage collected for the driver: debit 1010, credit 2150 Carriage Payable - Rickshaw. Payouts debit 2150 and credit 1010, including the default CASH payment method as specified. These are balance-sheet entries only. Quantities are informational and never change inventory or stock movements.

POST /api/v1/trips and POST /api/v1/trips/payments require an Idempotency-Key header. Partial payments allocate to the oldest eligible trips first. Paid and partially paid trips are locked against editing and deletion. Unpaid changes reverse the prior journal before posting a replacement; unpaid deletion reverses the collection. Optional customer and invoice links never change invoice totals.

Apply supabase/migrations/20261116140000_rickshaw_trips.sql before deploying. Cloud Run uses Dockerfile.rickshaw and cloudbuild.rickshaw.yaml to preserve the existing production runtime.

Run only the targeted smoke: npm test --prefix backend -- --maxWorkers=1 test/rickshaw-trips.smoke.test.ts

The smoke uses disposable PGlite, loads schema without running historical test suites, creates TEST-D1 and the two specified trips, pays 3800, and checks zero P&L and stock impact. Its transaction is rolled back to remove the paid trips, driver, payout and journals without bypassing the paid-trip deletion guard.
