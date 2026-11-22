# Finance Tracker

Personal finance tracker (one wallet) in PHP (₱). The **owner** manages everything; their **partner** can view the wallet (except private accounts) and log entries. PERN stack: Postgres on Neon, Express API on Render, a React overview site on Vercel, and an Expo Android app for entering data.

```
server/   Express API + SQL migrations
shared/   constants and money maths shared by server, web and mobile
web/      React overview site          (step 5)
mobile/   Expo Android app             (steps 3–4)
```

## Setup (step 1)

1. `npm install` (from this folder)
2. Database: the project is linked to Neon (`.neon`, `neon.ts`). `npx neon@latest deploy` (or `npx neon@latest env pull`) writes `DATABASE_URL` (pooled, used by the API) and `DATABASE_URL_UNPOOLED` (direct, used by migrations) to `.env.local`.
3. `server/.env` holds `JWT_SECRET` and the other server settings (see `server/.env.example`). Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
4. `npm run migrate` creates the tables on Neon. It's safe to run again.
5. `npm run build` checks that every server file loads; `npm run dev` starts the API at http://localhost:4000
6. `npm test` runs the tests against an in-memory Postgres; no Neon needed.

Env files load in this order (later ones win): `.env.local` (from Neon), then `server/.env`.

**On Render**, set `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`, `JWT_SECRET`, `CORS_ORIGINS` (your Vercel URL) and `NODE_ENV=production`. Build command: `npm install && npm run migrate`. Start command: `npm start -w server`.

## Phone app (mobile/)

Expo SDK 58 + Expo Router (JavaScript). Screens live in `mobile/src/app/`.

**Try it on your phone (development):**
1. Install **Expo Go** from the Play Store. It must be the version that supports SDK 58.
2. Terminal 1: `npm run dev` starts the API on port 4000.
3. Terminal 2: `npm run mobile`, then scan the QR code with Expo Go. The phone and PC must be on the same Wi-Fi.
4. The app talks to `http://<your PC's IP>:4000` automatically. If Windows asks whether Node.js may use the network, allow **private networks**. Otherwise the phone can't reach the API.

**Features:** sign in / create household / join with an invite code, Home dashboard (Me / Partner / Combined), **double-tap anywhere on Home or Activity to add a transaction** (or the + button), transfers with fee presets and remembered route fees, live balance preview, activity history with search and filters, accounts (private, shared, archive), income & bills, partner invites, fee presets.

**Deep link to quick-add:** `financetracker://add`, `financetracker://add?type=transfer`, `financetracker://add?type=income`. Step 4 hooks home-screen shortcuts, the notification-panel tile and the widget up to these.

Checks: `npm run export -w mobile` (bundles the Android app) and `npm run doctor -w mobile`.

### Quick add
Open it with: double-tap on Home/Activity, the Expense / ⇄ / Income buttons on Home, **long-press the app icon**, the **quick settings tile**, or the **home-screen widget**.
- **Expense / Income:** pick the account, type the amount (+ and − keys add things up), then **swipe the whole card like Tinder: left = expense, right = income** (it tilts and shows an EXPENSE / INCOME stamp).
- **Transfer:** pick From and To, set the fee (pre-filled from your last transfer on that route), then **slide to transfer**.
- A full-colour confirmation lets you tag a category, add another entry, or tap anywhere to close.
- **No signal?** The entry is saved on the phone and synced automatically (Home shows "saved offline").

### Native extras (modules/wallet-shortcuts, Kotlin)
App icon shortcuts, quick settings tile ("Add transaction"), home-screen widget (balance + Expense/Transfer buttons, with a setting to hide the balance). They need the installed app, not Expo Go.

### Building the app (EAS)
Run from `mobile/`. EAS needs the project in a git repo (it uploads the whole monorepo so `shared/` is included); it offers to `git init` and make the first commit.
```
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile development   # dev build: loads JS live from `npm run mobile`
npx eas-cli@latest build -p android --profile preview       # standalone APK (set EXPO_PUBLIC_API_URL to the Render URL first)
```

## API so far

All money values are integer **centavos** (₱15.00 = `1500`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | API + database check |
| POST | `/auth/register` | none | `{email, password, display_name, household_name?, invite_code?}`. Without an invite code it creates a household (you become owner); with one it joins the inviter's household |
| POST | `/auth/login` | none | `{email, password}`, returns `{token, user}` |
| GET | `/auth/me` | token | current user |
| POST | `/auth/logout-all` | token | signs out every device |
| GET | `/household` | token | household + members |
| PATCH | `/household` | owner | rename household |
| POST | `/household/invites` | owner | creates a partner invite code (e.g. `K7PM-W3QX`, valid 7 days, single use) |
| GET | `/household/invites` | owner | active invites |
| DELETE | `/household/invites/:id` | owner | cancel an invite |

Send the token as `Authorization: Bearer <token>`. Everything below needs a token.

### Accounts
| Method | Path | Purpose |
|---|---|---|
| GET | `/accounts?include_archived=true` | accounts you can see, with `balance_cents`, `can_edit` |
| GET | `/accounts/:id` | one account |
| POST | `/accounts` | owner only. `{name, type, opening_balance_cents?, is_private?, sort_order?}`. Enter credit card debt as a negative opening balance |
| PATCH | `/accounts/:id` | owner only. Any of the above, plus `archived` |
| DELETE | `/accounts/:id` | only if it has no transactions (otherwise archive it) |

### Transactions
| Method | Path | Purpose |
|---|---|---|
| GET | `/transactions` | filters: `from`, `to`, `type`, `account_id`, `category_id`, `created_by`, `q` (note search), `limit` (≤200), `offset`. Returns `{transactions, has_more}` |
| GET | `/transactions/:id` | one transaction |
| POST | `/transactions` | `{client_id?, type, amount_cents, account_id, to_account_id?, fee_cents?, fee_paid_by?, category_id?, occurred_on?, note?}`. Date defaults to today (Manila). Re-sending a `client_id` returns the existing one (`created: false`) |
| POST | `/transactions/sync` | `{transactions: [...]}` (≤100, each needs `client_id`). Returns a per-item `created` / `duplicate` / `error` |
| PATCH | `/transactions/:id` | change any field; changing the type clears a category that no longer fits |
| DELETE | `/transactions/:id` | soft delete; the balance is restored |

### Categories, fee presets, recurring
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/categories` | list (`?kind=expense`, most recently used first) / create `{name, kind, icon?}` |
| PATCH/DELETE | `/categories/:id` | rename, change icon or archive. Built-in "Transfer fees" is protected |
| GET/POST | `/fee-presets` | named presets (InstaPay ₱15…) / create `{name, fee_cents, fee_paid_by?}` |
| GET | `/fee-presets/suggest?from=&to=` | fee last used on that route, for pre-filling transfers |
| PATCH/DELETE | `/fee-presets/:id` | edit / remove a named preset |
| GET/POST | `/recurring` | salary, bills, subscriptions: `{kind, name, amount_cents, frequency, account_id?, category_id?, next_date?, active?}`. Responses include `monthly_equivalent_cents`. Creating is owner only |
| PATCH/DELETE | `/recurring/:id` | owner only |

Frequencies: `weekly`, `fortnightly`, `semi_monthly` (kinsenas, the 15th and 30th), `monthly`, `quarterly`, `yearly`.

### Summary (dashboard / website)
| Method | Path | Purpose |
|---|---|---|
| GET | `/summary?month=YYYY-MM` | net worth, assets, liabilities, balance by type, accounts, the month's income/expenses/transfer fees by category, monthly recurring income vs bills, bills due in the next 30 days, latest 10 transactions |
| GET | `/summary/net-worth?months=12` | net worth at the end of each month, for charts |

### Roles and privacy
- **Owner** (whoever created the wallet): sees and changes everything (accounts, income and bills, categories, fee presets, invites) and can edit any entry.
- **Partner** (joined with an invite code): sees every non-private account, can log transactions on them, and can edit or delete **only the entries they logged**. Can't change accounts or settings.
- **Private** accounts, their transactions, and income/bills tied to them are invisible to the partner, including in totals.
- A transfer between a private account and a visible one appears to the partner with the hidden side shown as "Private account", and is read-only for them.

## Data rules
- Account balance = opening balance + all transactions (the `account_balances` view), so it can never drift.
- Transfer fee paid by **sender**: source −(amount + fee), destination +amount.
  Paid by **receiver**: source −amount, destination +(amount − fee).
  Fees are reported under the system category **Transfer fees**.
- All accounts belong to the wallet owner. **Private** accounts are hidden from the partner.
- Every transaction carries a `client_id` generated on the phone, so syncing offline entries twice never duplicates them.

### Smart features (Settings → Smart features)
- **Fingerprint lock** (expo-local-authentication): asks on launch and after 1 minute in the background; falls back to your phone PIN.
- **Bill & payday reminders** (expo-notifications, local): bills at 6 PM the day before, income at 9 AM on the day, for the next 60 days from each item's next date. Tapping one opens Income & Bills. Normal notifications, so they also trigger the phone's notification lights.
- **Payment detection** (owner only; Kotlin `MoneyNotificationListener`): with Notification access granted, GCash / Maya / bank alerts (including bank SMS) are parsed on the phone (`shared/src/detect.js`, mirrored in `MoneyParser.kt`). Each match shows a "Log ₱500 expense?" notification and appears under "Detected payments" on Home; tapping opens quick add pre-filled with the amount and the matching account. OTPs, promos and balance messages are ignored. Raw text never leaves the phone.
  - Sideloaded APKs on Android 13+ may show "Restricted setting" when granting access: App info → ⋮ → Allow restricted settings.

### People (utang)
A person is an account of type `person`: **positive balance = they owe you, negative = you owe them**, and it counts toward net worth.
- Lend: Transfer **Wallet → Juan** (or **Credit card → Juan** if they used your card).
- Repayment: Transfer **Juan → GCash** (partial amounts are fine).
- Borrow: Transfer **Tita → Wallet** (her balance goes negative); pay back with **Wallet → Tita**.
- Write off: an expense on the person in the built-in **Written off** category.
- Optional due date (reminder the evening before) and note; people can be private.
- Summary returns `owed_to_you_cents` and `you_owe_cents`; liabilities include what you owe people. Income can't be logged directly on a person (use a transfer).

### Loans / pay later (BillEase, SPayLater, GGives, Atome, Home Credit…)
Accounts → **Set up a loan / pay later** (`POST /loans`, owner only) creates in one go: a debt account ("BillEase · Phone"), the purchase (expense) or cash-out (transfer into your account), the interest & fees (expense, category **Interest & fees**), and a monthly reminder linked to the loan. Each payment is a transfer (GCash → loan); the loan screen shows "3 of 6 paid" with a **Pay** button. When the balance reaches 0 the reminder stops and it no longer counts as a monthly bill (`paid_off`). Payment detection treats lender alerts as **loan payments** (not income) and ignores "payment due" reminders.

### Getting started guide (`/setup`)
Home shows **Set up your finances** (owner) until finished or dismissed; also in Settings. Steps: money you have (bank/e-wallet/cash presets with today's balance) → credit cards (amount owed) → loans you're already paying (`POST /loans` with `kind: "existing"`: starts at the remaining balance, nothing counted as this month's spending) → utang → salary & bills (day-of-month due dates) → starting net worth.

### Payslips (salary, part-time, projects)
`POST /payslips` records pay as an income transaction for the **net** amount plus a breakdown (`gross_cents`, `lines[]` of addition / contribution / tax / lost_pay / fee / other). `GET /payslips/template` pre-fills from the last payslip of the same source and cutoff (1–15 vs 16–end). `GET /payslips/summary?year=` gives totals per kind, label (SSS, PhilHealth, Pag-IBIG…), source and month. Breakdowns are private by default (partner sees only the net income). A salary's expected amount (and the monthly plan) uses the average net of its latest payslips (4 for twice-a-month, else 3). App: Income & Bills → **Log pay** / **Deductions**; the payday reminder opens Log pay. Part-time can compute gross from hours × rate; projects deduct platform fees / withholding tax.

### Recent additions
- **Custom days** schedule for income & bills (`frequency: "custom_days"`, `days_of_month: [13, 16]`; 31 = last day of short months). Monthly totals count each day.
- **Onboarding:** `users.onboarded_at`; `POST /auth/onboarded`. New owners with no accounts are sent to `/setup` (can skip); the Home card disappears once finished or skipped.
- **Reset my data:** `POST /household/reset { confirm: "RESET" }` (owner) deletes accounts, transactions, loans, people, bills and payslips; keeps logins, partner access, categories and named fee presets.
- **MariBank** added to payment detection and setup presets; amounts written after the currency ("2,950.00 GCASH") are recognised.
- **Widget** is now a slim quick-add bar (Expense / Income / Transfer), no balance shown.
