# Spendly – Project Context & Development History

Use this document to provide complete context to an AI assistant regarding the **Spendly** project, its architecture, feature set, and what has been implemented so far.

---

## 📌 Project Overview
- **Project Name:** Spendly – Daily Expense Tracker
- **Type:** Lightweight, client-side Progressive Web Application (PWA ready)
- **Tech Stack:** Pure Vanilla Web Stack (Zero external build dependencies)
  - **HTML5:** Semantic, accessible mobile-first structure (`index.html` - 657 lines)
  - **CSS3:** Custom luxury dark-mode design system with glassmorphism, animations, ripple feedback, responsive layout (`styles.css` - 2,266 lines)
  - **JavaScript (ES6+):** Pure Vanilla JS reactive state management and DOM controller (`app.js` - 1,060 lines)
  - **Storage:** Client-side persistent storage via `localStorage` (100% offline, privacy-first)

---

## 🚀 Key Features Implemented (Phases 1 to 5)

### 1. App Shell & Security (Phase 1)
- **Branded Splash Screen:** Animated logo reveal with smooth transition.
- **PIN Lock Screen:** 4-digit PIN authentication (Default: `1234`) featuring an interactive numeric keypad, letter subs, ripple feedback, error shake animations, and keyboard support.

### 2. Personalization & Dual-Wallet System (Phase 2)
- **Persona Onboarding:** Custom setup screen catering to distinct financial personas:
  - 🎓 *Student* (Tuition, mess, pocket money)
  - 💼 *Salaried* (EMIs, bills, monthly budget)
  - 🏢 *Business Owner* (Personal vs. business cashflows)
- **Dual Wallets:**
  - Separate balances for **Cash Wallet 💵** and **Online / UPI Wallet 💳**.
  - Combined **Total Balance Hero Card** with smooth cubic-bezier number rolling animations.
- **Quick Balance Top-ups:** Dedicated bottom sheet modal to inject funds into either wallet with preset chips (`+₹500`, `+₹1,000`, `+₹2,000`, `+₹5,000`).

### 3. Expense Tracking & Smart Categorization (Phase 3)
- **Floating Action Button (FAB) & Quick Actions:** One-tap expense logging bottom sheet.
- **Smart Category Auto-Detection:** Automatically suggests and selects categories when entering recurring amounts (e.g., `₹1800` → Rent, `₹2800` → Mess, `₹100` → Router).
- **Wallet Source Selection:** Choose Cash vs. Online wallet with live balance validation (disables submission and alerts on insufficient balance).
- **Dynamic Transaction Feed:** Displays category emojis, wallet origin, notes, and relative date labels (*Today*, *Yesterday*, or formatted date).

### 4. Advanced Money Management & Calendar (Phase 4)
- **Deferred Split Payments:**
  - "Split into next month" toggle for large bills (e.g., rent, sem fees).
  - Deducts 50% immediately and schedules the remaining 50% as a pending liability due on the 1st of next month with a visual countdown badge.
- **Interactive Calendar View:**
  - Full monthly calendar navigation (previous / next month).
  - Days marked with dots indicator where expenses occurred.
  - Interactive day filter: click a date to view "On This Day" expenses or clear to view "All This Month".
- **Dashboard Tab Bar & Bottom Nav:** Seamless navigation between *Overview*, *Calendar*, and *Settings*.

### 5. Khata Book & Data Portability (Phase 5)
- **Khata Book ("Who Owes Me"):**
  - "Paid for Friend (Lent Money)" toggle inside expense modal.
  - Deducts from user's wallet but routes into a lent records ledger rather than regular expenses.
  - Aggregates debts by friend's name, display initials, total amount owed, payment counts, and clear/settle actions.
- **Data Safety & Backup:**
  - **Export Data:** Generates and downloads a clean `spendly_backup.json` of the entire database.
  - **Import Data:** Restores database from a JSON backup file with schema integrity checks.
  - **Danger Zone:** Independent reset options for clearing Khata entries or wiping all user data.

---

## 🗂️ Data Schema (`spendly_db` in `localStorage`)
```json
{
  "currentCashBalance": 0,
  "currentOnlineBalance": 0,
  "transactions": [
    {
      "id": 1718000000000,
      "date": "2026-06-01T10:00:00.000Z",
      "amount": 1800,
      "category": "Rent",
      "notes": "Paid room rent",
      "wallet": "online"
    }
  ],
  "pendingLiabilities": [
    {
      "id": 1718000000001,
      "dueDate": "2026-07-01T00:00:00.000Z",
      "amount": 900,
      "category": "Rent",
      "notes": "Rent [deferred 50%]",
      "fromWallet": "cash"
    }
  ],
  "lentRecords": [
    {
      "id": 1718000000002,
      "date": "2026-06-01T12:00:00.000Z",
      "amount": 250,
      "friendName": "Rahul",
      "category": "Mess",
      "notes": "Lunch split",
      "wallet": "cash"
    }
  ]
}
```

---

## 💻 How to Run / Develop
1. No build steps or `npm install` needed.
2. Open `index.html` directly in any modern browser, or run via VS Code Live Server / any local static server.
3. Default PIN: `1234`.
