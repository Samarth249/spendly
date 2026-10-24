# Spendly

Spendly is a personal budgeting and expense tracking web app. It helps users track cash and online wallet balances, record spending, and keep tabs on money lent to friends.

## Features

- Register and sign in with an account.
- Track separate cash and online balances.
- Record expenses and income by category, wallet, and date.
- Review spending in dashboard and calendar views.
- Track deferred expenses and amounts lent to friends (Khata).
- Use the app shell as a Progressive Web App (PWA), with offline support.

## Technology

- Frontend: HTML, CSS, and vanilla JavaScript.
- Backend: Node.js and Express.
- Data storage: SQLite.
- Authentication: bcrypt password hashing and JSON Web Tokens.

## Run locally

Requirements: Node.js 18 or newer and npm.

In PowerShell, from the project directory:

```powershell
cd "D:\Budget App\backend"
npm install
npm start
```

Open <http://localhost:5000> in your browser. The server also serves the sign-in page at `/login.html` and sign-up page at `/register.html`.

For development with Node's file watcher, use `npm run dev` from the `backend` directory.

## Project layout

```text
.
|-- index.html, login.html, register.html  # App and account pages
|-- app.js, styles.css                     # Frontend behavior and styles
|-- manifest.json, sw.js                   # PWA configuration and service worker
`-- backend/
    |-- server.js                          # Express server and API
    |-- database.js                        # SQLite setup
    `-- package.json                       # Backend dependencies and scripts
```

The backend listens on port `5000` by default. Set the `PORT` environment variable to use another port. SQLite data is stored by the backend in `backend/spendly.db`.
