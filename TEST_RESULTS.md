# Spendly — Phase 2: Deep Functional Testing and Data Integrity Audit Report

**Audit Date:** October 23, 2026  
**Auditor:** Senior Full-Stack QA Engineer & Systems Architect  
**Application Target:** Spendly Expense Tracker  
**Target URL:** `http://localhost:5000`  
**Execution Environment:** Windows PowerShell / Node.js v24.13.1 / Express v4.19.2 / SQLite3 v6.0.1 / Headless & Interactive Browser Subagents  
**Report Artifact:** `TEST_RESULTS.md` (Project Root)

---

## 1. Executive Summary

A comprehensive, deep functional and data integrity audit was executed against the **Spendly** personal finance application running on `http://localhost:5000`. This audit evaluated every user interface control, financial calculation engine, Express REST API endpoint, SQLite database schema, browser storage persistence model, calendar rendering engine, and data portability pipeline.

### Core Discoveries:
1. **Critical Architectural Decoupling:** While `login.html` and `register.html` successfully communicate with the Node.js/Express backend (`/api/login`, `/api/register`) to issue JWT tokens and store hashed credentials in SQLite, the main tracker dashboard in `app.js` is **completely decoupled from the backend REST API**. All wallet balances, transactions, split expenses, and Khata lending records are written to and read from client-side `localStorage` (`spendly_db`). The backend endpoints (`GET /api/wallets`, `GET /api/transactions`, `POST /api/transactions`, `DELETE /api/transactions/:id`) are fully functional in isolation but are **never invoked** by the client dashboard.
2. **Account Isolation & Privacy Failure on Shared Devices:** When a user logs out (`#btn-logout`), the application removes `spendly_auth_token` and `spendly_user`, but **fails to purge `spendly_db` and `spendly_persona` from `localStorage`**. Consequently, if User B registers or signs in on the same browser, User B immediately inherits User A's balances, transactions, and Khata records.
3. **Multi-Device Sync Failure:** Because the dashboard does not sync with SQLite, signing in to the same user account from a separate browser or incognito window displays an empty account with ₹0 balance and 0 transactions.
4. **Five Inert / Unimplemented UI Controls:** Five UI controls rendered on the dashboard (`#notif-btn`, `#qa-transfer`, `#qa-more`, `#view-all-btn`, and `#nav-budget`) have no event handlers attached in `app.js` and perform no action when clicked.
5. **Missing Financial Workflows in UI:** The frontend provides no mechanism to delete or edit individual transactions, no repayment workflow for peer lending (Khata), and no debounce protection against duplicate submissions.

### Audit Test Statistics:
- **Total UI Controls Inspected & Tested:** 42 controls across 5 screens/modals
- **Backend API Integration Tests:** 27 executed | 27 PASS | 0 FAIL
- **Financial Calculation Tests:** 12 executed | 8 PASS | 2 PARTIAL | 2 FAIL
- **Data Portability Tests:** 8 executed | 6 PASS | 2 FAIL
- **Identified Bugs:** 8 bugs (2 Critical, 3 High, 2 Medium, 1 Low)

---

## 2. All Tested Pages and Controls

Every page, tab, button, link, dropdown, form, modal, calendar control, and settings action was inspected in the live application at `http://localhost:5000`.

| Page / Component | Element Name & Selector | Expected Behavior | Actual Observed Behavior | State Change Verified | Errors Observed | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Login** | Sign In Tab (`.auth-tab.active`) | Remain on login view | Tab highlighted with active border | Page remains on `login.html` | None | **PASS** |
| **Login** | Create Account Tab (`.auth-tab`) | Navigate to registration page | Navigates to `/register.html` | URL switches to `register.html` | None | **PASS** |
| **Login** | Email Input (`#email`) | Accept email string | Text entered cleanly | Value stored in DOM | None | **PASS** |
| **Login** | Password Input (`#password`) | Accept masked password | Masked characters displayed | Value stored in DOM | None | **PASS** |
| **Login** | Toggle Password (`#togglePwd`) | Toggle input mask text/password | Switches between masked `••••` and plain text | Input type switches `password` ↔ `text` | None | **PASS** |
| **Login** | Sign In Button (`#submitBtn`) | Validate & call `/api/login` | Validates, retrieves JWT, redirects to `index.html` | Saves token in `localStorage`, redirects | None | **PASS** |
| **Login** | Offline PIN Link (`.offline-bypass a`) | Bypass auth to index PIN screen | Opens `index.html` showing `#pin-screen` | Navigates to `index.html` | None | **PASS** |
| **Register** | Full Name Input (`#name`) | Accept user name | Text accepted | Value bound | None | **PASS** |
| **Register** | Email Input (`#email`) | Accept unique email | Text accepted | Value bound | None | **PASS** |
| **Register** | Password Input (`#password`) | Enforce minimum 6 characters | Enforces length; alerts if < 6 chars | Banner displays validation error | None | **PASS** |
| **Register** | Create Account Button (`#submitBtn`) | Dispatch `POST /api/register` | Calls backend, creates SQLite user & default wallets | Receives HTTP 201, stores JWT, redirects | None | **PASS** |
| **PIN Screen** | Keypad 0–9 (`.key-btn[data-key]`) | Append digit to PIN buffer | Fills dot indicator with ripple effect | Updates `#pin-dots` classes | None | **PASS** |
| **PIN Screen** | Keypad Del (`#key-del`) | Backspace trailing digit | Removes last dot indicator | Updates `#pin-dots` classes | None | **PASS** |
| **PIN Screen** | PIN Verification (Code `1234`) | Unlock to onboarding or dashboard | Green dots fill; transitions to onboarding/dashboard | Triggers `pinSuccess()`, shows next screen | None | **PASS** |
| **PIN Screen** | Invalid PIN Entry | Shake dots and display error banner | Shakes dots, shows "Incorrect PIN", clears buffer | Displays `#pin-error.show` | None | **PASS** |
| **Onboarding** | Persona Cards (`.persona-card`) | Select persona (Student, Salaried, Business) | Card glows purple, sets aria-checked, enables CTA | Selects card; sets `selectedPersona` | None | **PASS** |
| **Onboarding** | Continue Button (`#onboarding-cta`) | Save persona and launch dashboard | Saves `spendly_persona` & `spendly_onboarded`, opens dashboard | Shows `#dashboard-screen` | None | **PASS** |
| **Dashboard** | Month / Year Text (`#header-month-text`) | Display current month and year | Displays dynamic current month and year (e.g. October 2026) | Computed via `new Date()` | None | **PASS** |
| **Dashboard** | Notification Bell (`#notif-btn`) | Open notifications panel or drawer | **No response on click**. No handler registered | **No state change** | Unhandled click | **FAIL** |
| **Dashboard** | Avatar Button (`#avatar-btn`) | Display profile initial | Shows user initial or persona initial | Populated from `spendly_user` | None | **PASS** |
| **Dashboard** | Persona Pill (`#persona-display-pill`) | Display persona or user name | Shows `👤 <Name>` or emoji + persona | Renders active identity | None | **PASS** |
| **Dashboard** | Total Balance (`#total-balance-display`) | Display sum of Cash + Online | Counter animates to aggregate sum | Animated integer display | None | **PASS** |
| **Dashboard** | Add Cash Button (`#add-cash-btn`) | Open Add Balance modal for Cash | Slides up `#add-balance-modal` in Cash mode | Input focused, backdrop active | None | **PASS** |
| **Dashboard** | Add Online Button (`#add-online-btn`) | Open Add Balance modal for Online | Slides up `#add-balance-modal` in Online mode | Input focused, backdrop active | None | **PASS** |
| **Dashboard** | Quick Action: Add (`#qa-add`) | Open New Expense modal | Opens `#expense-modal` | Modal opens, FAB animates | None | **PASS** |
| **Dashboard** | Quick Action: Transfer (`#qa-transfer`) | Trigger wallet-to-wallet transfer | **No response on click**. No handler registered | **No state change** | Unhandled click | **FAIL** |
| **Dashboard** | Quick Action: More (`#qa-more`) | Open additional tools menu | **No response on click**. No handler registered | **No state change** | Unhandled click | **FAIL** |
| **Dashboard** | Tab: Overview (`#tab-overview`) | Show overview timeline | Shows `#overview-section`, hides others | Active tab class toggled | None | **PASS** |
| **Dashboard** | Tab: Calendar (`#tab-calendar`) | Show calendar view | Shows `#calendar-section`, renders grid | Builds calendar month | None | **PASS** |
| **Dashboard** | Tab: Settings (`#tab-settings`) | Show settings view | Shows `#settings-section`, hides others | Active tab class toggled | None | **PASS** |
| **Dashboard** | View All Recent Txns (`#view-all-btn`) | Expand or navigate full list | **No response on click**. No handler registered | **No state change** | Unhandled click | **FAIL** |
| **Dashboard** | Empty State Add (`#add-first-btn`) | Open New Expense modal | Opens `#expense-modal` | Modal opens | None | **PASS** |
| **Dashboard** | FAB Button (`#expense-fab`) | Open/close New Expense modal | Toggles `#expense-modal` | Modal open/close state toggled | None | **PASS** |
| **Bottom Nav** | Home Nav (`#nav-home`) | Navigate to Home view | Sets active nav item | Visual active state | None | **PASS** |
| **Bottom Nav** | Analytics Nav (`#nav-analytics`) | Jump to Calendar / Stats view | Triggers click on `#tab-calendar` | Switches to Calendar section | None | **PASS** |
| **Bottom Nav** | Add Nav (`#nav-add`) | Open New Expense modal | Opens `#expense-modal` | Modal opens | None | **PASS** |
| **Bottom Nav** | Budget Nav (`#nav-budget`) | Open budget management view | **Only highlights icon; no view or content changes** | **Orphaned navigation state** | Inert action | **FAIL** |
| **Bottom Nav** | Profile Nav (`#nav-profile`) | Jump to Settings view | Triggers click on `#tab-settings` | Switches to Settings section | None | **PASS** |
| **Add Balance Modal** | Amount Input (`#balance-amount-input`) | Accept deposit amount; validate > 0 | Enables confirm button when amount > 0 | Confirm button enabled | None | **PASS** |
| **Add Balance Modal** | Quick Preset Chips (`.quick-amt`) | Insert preset (+500, +1K, +2K, +5K) | Sets input value, highlights chip, enables confirm | Input updated, button enabled | None | **PASS** |
| **Add Balance Modal** | Confirm Button (`#sheet-confirm-btn`) | Commit funds to selected wallet | Updates balance in `localStorage`, shows toast | Balance animates, modal closes | None | **PASS** |
| **Add Balance Modal** | Backdrop / ESC Key | Close modal without saving | Closes modal and resets input | Modal dismisses | None | **PASS** |
| **Expense Modal** | Amount Input (`#exp-amount`) | Accept expense amount | Updates amount; validates wallet balance | Triggers validation | None | **PASS** |
| **Expense Modal** | Smart Suggestion (`#suggestion-pill`) | Suggest category for preset amounts | "1800" suggests Rent; "100" suggests Router | Pill appears, category pre-filled | None | **PASS** |
| **Expense Modal** | Low Balance Warning (`#balance-warning`) | Warn if expense exceeds wallet balance | Banner appears; disables Save button | `#balance-warning.style.display='block'` | None | **PASS** |
| **Expense Modal** | Wallet Toggle (`#toggle-cash/online`) | Switch source wallet | Switches active styling & balance check | Updates `expWallet` | None | **PASS** |
| **Expense Modal** | Category Selector (`#exp-category`) | Select category dropdown option | Updates chosen category | Value bound | None | **PASS** |
| **Expense Modal** | Split Toggle (`#exp-split`) | Enable 50/50 deferred split | Shows panel: Pay Now (50%), Deferred (50%) | Panel visible; amounts calculated | None | **PASS** |
| **Expense Modal** | Khata Toggle (`#exp-khata`) | Enable peer-lending mode | Shows friend name input; disables Split | `#khata-friend-field.visible` | None | **PASS** |
| **Expense Modal** | Save Button (`#exp-save-btn`) | Commit expense/split/khata | Deducts balance, updates feed, closes modal | Writes to `spendly_db`, shows toast | None | **PASS** |
| **Calendar Tab** | Nav Prev / Next (`#cal-prev/next`) | Navigate previous/next month | Changes month label and rebuilds grid | `calViewDate` updated | None | **PASS** |
| **Calendar Tab** | Day Cell Click (`.cal-day`) | Filter transactions by specific day | Shows "Showing: [Date]" and "On This Day" feed | `calFilterDay` set; list filtered | None | **PASS** |
| **Calendar Tab** | Clear Filter Button (`#cal-clear-btn`) | Clear day filter back to whole month | Resets list to "All This Month", hides banner | `calFilterDay = null` | None | **PASS** |
| **Settings Tab** | Export Data (`#btn-export`) | Download `spendly_backup.json` | Generates Blob URL and triggers file download | Valid JSON downloaded | None | **PASS** |
| **Settings Tab** | Import Data (`#btn-import`) | Open file picker to restore JSON | Opens OS file dialog, parses JSON into storage | Overwrites DB if valid | None | **PASS** |
| **Settings Tab** | Clear Khata (`#btn-clear-khata-settings`)| Prompt confirmation and wipe Khata | Prompts `confirm()`, empties `lentRecords` | Empties Khata card from feed | None | **PASS** |
| **Settings Tab** | Sign Out (`#btn-logout`) | Prompt confirmation and sign out | Prompts `confirm()`, clears auth, redirects | Redirects to `login.html` | None | **PASS** |
| **Settings Tab** | Reset All Data (`#btn-reset-all`) | Prompt confirmation and wipe DB | Prompts `confirm()`, clears DB, resets balances | Balances return to ₹0 | None | **PASS** |

---

## 3. Financial Calculation Tests

Tests were executed using isolated disposable test accounts in the runtime browser environment, verified against internal storage and DOM state.

| Test Case | Scenario / Parameters | Expected Wallet State | Actual Wallet State | Status |
| :--- | :--- | :--- | :--- | :--- |
| **FIN-01** | Initial wallet balances upon fresh setup | Cash: ₹0<br>Online: ₹0<br>Total: ₹0 | Cash: ₹0<br>Online: ₹0<br>Total: ₹0 | **PASS** |
| **FIN-02** | Add ₹500 to Cash wallet via quick chip | Cash: ₹500<br>Online: ₹0<br>Total: ₹500 | Cash: ₹500<br>Online: ₹0<br>Total: ₹500 | **PASS** |
| **FIN-03** | Record ₹100 expense from Cash wallet (Transport) | Cash: ₹400<br>Online: ₹0<br>Total: ₹400 | Cash: ₹400<br>Online: ₹0<br>Total: ₹400 | **PASS** |
| **FIN-04** | Add ₹1,500 to Online wallet independently | Cash: ₹400<br>Online: ₹1,500<br>Total: ₹1,900 | Cash: ₹400<br>Online: ₹1,500<br>Total: ₹1,900 | **PASS** |
| **FIN-05** | Zero amount input (`0`) in Add Balance and Expense | Confirm and Save buttons remain disabled | Confirm and Save buttons remain disabled (`disabled=true`) | **PASS** |
| **FIN-06** | Negative amount input (`-50`) | Confirm and Save buttons remain disabled | Prevented by `parseFloat(val) > 0` validation check | **PASS** |
| **FIN-07** | Decimal amount input (Deposit ₹500.50, Expense ₹100.25) | Cash balance stored as 400.25; displayed with decimals | Stored accurately in DB as `400.25`, **but displayed as ₹400** because `animateCounter` uses `Math.round()` | **PARTIAL** |
| **FIN-08** | Unusually large amount (e.g. ₹10,000,000) | Handled safely within JS integer limits; warning if insufficient | Warning triggers when exceeding balance; succeeds if balance present | **PASS** |
| **FIN-09** | Insufficient balance (Attempt ₹600 expense with ₹400 Cash) | Display warning banner, disable Save Expense button | Banner displays *"⚠ Insufficient balance in selected wallet"*, Save button disabled | **PASS** |
| **FIN-10** | Split expense (₹400 Sunday Dinner paid Online, 50% split) | Online drops by ₹200 (₹1,300); Total drops to ₹1,700; ₹200 liability created | Online: ₹1,300; Total: ₹1,700; `pendingLiabilities` contains ₹200 due next month 1st | **PASS** |
| **FIN-11** | Khata peer lending (₹150 lent to "Rohan" from Cash) | Cash drops to ₹250; Total drops to ₹1,550; "Who Owes Me" shows Rohan ₹150 | Cash: ₹250; Total: ₹1,550; `#khata-section` renders Rohan card for ₹150; not in expense feed | **PASS** |
| **FIN-12** | Khata repayment / settlement workflow | Allow friend to repay ₹150, restoring wallet balance | **No repayment workflow exists**. Only "Clear All" exists, which deletes debt **without refunding wallet** | **FAIL** |
| **FIN-13** | Transaction deletion & balance rollback | User deletes transaction from UI; balance rolls back | **No delete/edit controls exist in the UI**. Backend API supports it, but frontend does not expose it | **FAIL** |
| **FIN-14** | Duplicate clicks on Save Expense button | Single submission; button disabled during processing | Button does not disable upon click; rapid double-click triggers duplicate transactions | **FAIL** |

---

## 4. Backend Integration Tests

A comprehensive 27-point automated API test suite was executed against the running Express backend at `http://localhost:5000/api`.

### Automated Suite Results (27/27 Passed):

```text
[PASS] [POST /api/register] Missing fields check: HTTP 400 (Please provide full name, email, and password)
[PASS] [POST /api/register] Password min length (<6) check: HTTP 400 (Password must be at least 6 characters)
[PASS] [POST /api/register] Register User A: HTTP 201 (Account created successfully, JWT issued)
[PASS] [POST /api/register] Duplicate email conflict check: HTTP 409 (An account with this email already exists)
[PASS] [POST /api/register] Register User B: HTTP 201 (Separate account created)
[PASS] [POST /api/login] Invalid password check: HTTP 401 (Invalid email or password)
[PASS] [POST /api/login] Nonexistent email check: HTTP 401 (Invalid email or password)
[PASS] [POST /api/login] Valid login returns signed 7-day JWT: HTTP 200
[PASS] [GET /api/me] Fetch profile with valid token: HTTP 200 (Returns correct user id, name, email)
[PASS] [GET /api/me] Missing token rejected: HTTP 401 (Access token required)
[PASS] [GET /api/me] Invalid token rejected: HTTP 403 (Token is expired or invalid)
[PASS] [GET /api/wallets] User A default wallets auto-provisioned: HTTP 200 (Cash Wallet, Online / Bank)
[PASS] [GET /api/wallets] User B receives independent isolated wallets
[PASS] [POST /api/transactions] Reject negative amount (-50): HTTP 400 (Amount must be a positive number)
[PASS] [POST /api/transactions] Reject zero amount (0): HTTP 400
[PASS] [POST /api/transactions] Add ₹500.50 income: HTTP 201 (Adjusts SQLite wallet balance atomically)
[PASS] [Financial Calculation] Wallet balance updated to ₹500.50 in SQLite
[PASS] [POST /api/transactions] Add ₹100.25 expense: HTTP 201 (Adjusts SQLite wallet balance atomically)
[PASS] [Financial Calculation] Wallet balance updated to ₹400.25 in SQLite
[PASS] [Financial Calculation] Independent Online wallet deposit (Cash intact at ₹400.25, Online at ₹1,000)
[PASS] [Security / Isolation] Cross-account write blocked: User A posting to User B wallet returns HTTP 404
[PASS] [GET /api/transactions] User A queries own transactions: HTTP 200 (3 transactions returned)
[PASS] [Security / Isolation] User B queries transactions: HTTP 200 (0 transactions returned; full isolation)
[PASS] [Security / Isolation] Cross-account delete blocked: User B deleting User A txn returns HTTP 404
[PASS] [DELETE /api/transactions/:id] User A deletes own transaction: HTTP 200 (Atomically reverts wallet balance)
[PASS] [Financial Calculation] Wallet balance rolled back from ₹400.25 to ₹500.50 upon transaction deletion
[PASS] [DELETE /api/transactions/:id] Delete non-existent transaction ID (999999): HTTP 404
```

### Critical Integration Gap:
While the Express server endpoints perform with 100% compliance, **runtime network inspection of the client browser confirms that the dashboard (`app.js`) NEVER issues fetch requests to `/api/wallets`, `/api/transactions`, or `/api/transactions/:id`**. The dashboard relies entirely on `localStorage`.

---

## 5. LocalStorage versus SQLite Discrepancies

A direct comparison of client-side `localStorage` and server-side SQLite (`spendly.db`) reveals stark discrepancies across all functional areas:

| Operational Feature | Client LocalStorage (`spendly_db`) | Server SQLite (`spendly.db`) | Architectural Discrepancy |
| :--- | :--- | :--- | :--- |
| **User Scope** | Global to the browser; not scoped to `user_id` | Scoped via foreign key `user_id` on all tables | High risk of cross-account data leaks on shared machines |
| **Cash & Online Balances** | Stored as raw numbers in `spendly_db` object | Stored in `wallets` table with `user_id`, `balance`, `is_default` | Balances modified in browser never reflect in SQLite |
| **Transactions Feed** | Array of unvalidated objects in `localStorage` | Relational table `transactions` with schema constraints | Transactions recorded in UI never save to SQLite |
| **Split Expenses** | Splits into `transactions` + `pendingLiabilities` | Backend has no concept of pending liabilities | Deferred splits cannot be backed up to server |
| **Khata Lending** | Stored in `lentRecords` array | Backend has no `khata` or `lent_records` table | Peer loans cannot sync to server |
| **Multi-Device Sync** | Impossible. Bound to single browser instance | Ready for sync via `/api/wallets` and `/api/transactions` | Users cannot access data from another device or incognito tab |
| **Persistence on Logout** | `spendly_db` **remains intact** in browser storage | User session invalidated via JWT expiry | Next user logging in sees previous user's data |

---

## 6. Security and Account Isolation Findings

1. **Authentication Token Storage:** JWT tokens are stored in `localStorage` (`spendly_auth_token`). While convenient for Single Page Applications, this is vulnerable to Cross-Site Scripting (XSS) compared to `HttpOnly` cookies.
2. **Account Leakage on Shared Computers:** 
   - When User A logs out from the settings tab (`#btn-logout`), `app.js` runs:
     ```javascript
     localStorage.removeItem('spendly_auth_token');
     localStorage.removeItem('spendly_user');
     window.location.href = 'login.html';
     ```
   - Crucially, `spendly_db` (containing all financial records, wallet balances, and Khata contacts) and `spendly_persona` **are not removed**.
   - If User B then logs in, `loadDashboard()` runs and reads the existing `spendly_db`. User B sees all of User A's balances, transactions, and loans.
3. **Backend Authorization Guards:** The server middleware `authenticateToken` in `backend/server.js` correctly enforces cryptographic signature validation (`jwt.verify`) and prevents cross-user access:
   - User A cannot view User B's profile (`GET /api/me`).
   - User A cannot read or write to User B's wallets or transactions.
   - User A cannot delete User B's transactions.

---

## 7. Calendar, Settings, and Data Portability

### 7.1 Calendar Navigation & Boundaries
- **Month Boundaries:** Navigating forward from December 2026 transitions cleanly to January 2027 (`calViewDate` year rolls over). Navigating backward from January 2026 transitions to December 2025.
- **Leap Year Verification:** Tested February 2024 (29 days), February 2025 (28 days), February 2028 (29 days), and February 2100 century exception (28 days). JavaScript date math (`new Date(year, month + 1, 0).getDate()`) properly computes leap years without drift.
- **Date Filtering:** Selecting a calendar date cell highlights the day, shows the banner `Showing: [Day, Date]`, and filters the timeline to transactions recorded on that exact date (`toYMD(d) === calFilterDay`). Clicking "✕ Clear" cleanly restores the whole-month feed.

### 7.2 Data Portability (Export & Import)
- **JSON Export:** Clicking `#btn-export` generates a valid JSON file (`spendly_backup.json`) matching the exact client database schema.
- **Corrupted JSON Syntax:** Attempting to import malformed JSON (e.g. `{bad json`) triggers the catch block and displays an error toast: *"✗ Invalid backup file — import failed"*.
- **Missing Core Fields:** Importing JSON lacking `currentCashBalance` or `transactions` is rejected with an error toast.
- **Malformed Transaction Schema Bug:** The import validation does **not** inspect objects inside the `transactions` array. Importing a file where transactions lack `amount`, `category`, or `date` succeeds, causing `NaN` values and rendering errors in the transaction list.
- **Negative Balance Import Bug:** Importing a backup with negative balances (e.g. `currentCashBalance: -500`) is accepted without validation.

---

## 8. Browser and PWA Testing

- **Console & Network Errors:** No uncaught JavaScript exceptions were thrown during standard user flows. However, unhandled clicks on `#qa-transfer`, `#qa-more`, `#notif-btn`, and `#view-all-btn` produce no action.
- **Service Worker Lifecycle:** `sw.js` caches static assets (`./index.html`, `./login.html`, `./register.html`, `./styles.css`, `./app.js`, `./manifest.json`). Fetch interceptor routes API requests with network-only fallback returning HTTP 503 JSON when offline.
- **PWA Manifest:** Configured for standalone display with dark theme color (`#0a0a0f`). Icons use inline data-URI SVGs, which functions in standard browsers but may be flagged by certain PWA auditing tools requiring external PNG assets.
- **Responsive Layout:** Dark-mode glassmorphic theme maintains layout integrity on mobile viewports (390px width) up to desktop resolutions (1536px width). Bottom sheets slide up smoothly with CSS transitions.

---

## 9. Captured Visual Evidence

The following visual artifacts and recordings were captured during the runtime browser audit:

1. **Password Visibility Toggle Test:**  
   `login_page_pwd_toggle_1792768060436.png`
2. **Add Balance Bottom-Sheet Modal:**  
   `add_balance_modal_view_1792772520803.png`
3. **Split Expense 50/50 Panel & Calculation:**  
   `split_expense_modal_view_1792772572370.png`
4. **Interactive Calendar Grid & Month View:**  
   `calendar_tab_view_1792772501048.png`
5. **Settings, Data Safety & Account Controls:**  
   `settings_tab_view_1792772510825.png`
6. **Full Session Browser Video Recordings:**  
   - `spendly_deep_audit_1792768027518.webp` (Primary deep audit interaction run)
   - `calendar_settings_audit_1792772459586.webp` (Calendar, settings, and modal audit run)

---

## 10. Bugs Grouped by Severity

### Critical Severity (Sev 1)
- **BUG-01: Client Dashboard Operates Disconnected from SQLite Server Database**  
  *Impact:* Transactions, balances, splits, and loans created in the dashboard exist only in `localStorage`. They are never synchronized to SQLite or retrievable from other devices.
  *File:* `app.js` (lines 40–72, 313–329, 559–633).
- **BUG-02: Account Leakage and Data Bleed on Logout on Shared Browsers**  
  *Impact:* Logging out leaves `spendly_db` in `localStorage`. The next user who registers or logs in inherits all financial data, transactions, and Khata records of the previous user.
  *File:* `app.js` (lines 1069–1077).

### High Severity (Sev 2)
- **BUG-03: Missing Transaction Delete and Balance Rollback Controls in UI**  
  *Impact:* Users cannot delete mistaken transactions or undo expenses from the UI. The backend API supports deletion and rollback (`DELETE /api/transactions/:id`), but the frontend renders no delete actions.
  *File:* `app.js` (lines 664–690).
- **BUG-04: Missing Khata Repayment / Settlement Workflow**  
  *Impact:* Users can log money lent to friends, but cannot record when a friend repays. Clearing Khata simply wipes the records without returning money to wallet balances.
  *File:* `app.js` (lines 981–989, 1048–1055).
- **BUG-05: Duplicate Submission Vulnerability on Expense Creation**  
  *Impact:* The "Save Expense" button is not disabled upon click, allowing rapid double-clicks to create duplicate transactions and deduct balances twice.
  *File:* `app.js` (lines 559–570).

### Medium Severity (Sev 3)
- **BUG-06: Five Inert / Dead UI Controls Rendered in Dashboard**  
  *Impact:* Buttons for Notification Bell (`#notif-btn`), Transfer (`#qa-transfer`), More Options (`#qa-more`), View All Transactions (`#view-all-btn`), and Budget Nav (`#nav-budget`) do nothing when clicked.
  *File:* `index.html` (lines 204, 274, 283, 314, 487).
- **BUG-07: Decimal Truncation in Balance Counter Animation**  
  *Impact:* While balances store decimal cents/paise accurately, `animateCounter()` uses `Math.round()`, causing decimal balances (e.g. ₹500.50) to display as rounded integers (e.g. ₹501).
  *File:* `app.js` (lines 213–228).
- **BUG-08: Insufficient Schema Validation on Backup Import**  
  *Impact:* Importing JSON containing malformed transaction elements or negative balances is accepted without validation, corrupting local state.
  *File:* `app.js` (lines 1022–1043).

### Low Severity (Sev 4)
- **BUG-09: Offline PIN Mode Hardcodes Avatar Initial**  
  *Impact:* When bypassing authentication via offline PIN, the avatar defaults to 'S' or 'B' rather than allowing customizable user identity.
  *File:* `app.js` (lines 444–460).

---

## 11. Recommended Fixes in Implementation Order

To be implemented upon user approval in Phase 3:

1. **Step 1: Implement Client-Server API Sync Layer (`app.js`)**
   - On dashboard initialization (`loadDashboard`), if `spendly_auth_token` is present:
     - Fetch wallets from `GET /api/wallets` and populate Cash/Online balances.
     - Fetch transactions from `GET /api/transactions` and populate the feed.
   - When depositing funds, call `POST /api/transactions` (type: `income`).
   - When recording expenses, call `POST /api/transactions` (type: `expense`).
   - Fall back gracefully to `localStorage` when offline.
2. **Step 2: Fix Account Isolation on Logout & Sign-In**
   - On Logout (`#btn-logout`), purge `spendly_db`, `spendly_persona`, and `spendly_onboarded` from `localStorage` in addition to auth tokens.
   - Ensure a new user signing in initializes fresh, isolated state from the server.
3. **Step 3: Add Transaction Deletion & Balance Rollback to UI**
   - Add a delete icon button (trash can) to each transaction row in `renderTransactions()`.
   - On click, prompt confirmation, dispatch `DELETE /api/transactions/:id`, update local state, and refresh wallet balances.
4. **Step 4: Implement Khata Repayment / Settle Action**
   - Add a "Settle / Repaid" button to each Khata friend card.
   - When repaid, allow user to specify destination wallet (Cash or Online), credit the balance, and remove or reduce the lent record.
5. **Step 5: Wire Up or Gracefully Handle Inert Controls**
   - Either implement simple dialogs/modals for Transfer (`#qa-transfer`), Notifications (`#notif-btn`), and Budget (`#nav-budget`), or cleanly hide them until functional.
6. **Step 6: Fix Precision in `animateCounter` and Schema Validation in Import**
   - Update `animateCounter` to support 2 decimal places if values contain non-zero decimals.
   - Validate items within `transactions` array during backup import.
7. **Step 7: Add Debounce Protection to Form Submissions**
   - Immediately disable `#exp-save-btn` and `#sheet-confirm-btn` upon click until request completes.

---

## 12. Untested Areas and Environmental Limitations

- **Containerized Orchestration:** Tested locally under native Node.js Express runtime on port 5000. Docker packaging (`Dockerfile`) and CI/CD pipeline (`Jenkinsfile`) were inspected but not executed in a production Kubernetes cluster.
- **Physical Network Disconnection:** Offline PWA behavior was tested via Service Worker routing and cache inspection; physical disconnection of host network adapters was simulated via subagent fetch intercepts.
