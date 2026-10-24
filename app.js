/* ═══════════════════════════════════════════════════════
   SPENDLY – PHASE 1 + 2 + 3  |  Vanilla JS App Controller
═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════
     CONSTANTS
  ══════════════════════════════════════════ */
  // This PIN only gates the offline browser view. Account data is protected by
  // the server session; a client-side PIN is never used as an API credential.
  const OFFLINE_APP_PIN   = '1234';
  const OFFLINE_PIN_MAX_ATTEMPTS = 5;
  const OFFLINE_PIN_LOCK_MS = 30 * 1000;
  const OFFLINE_PIN_STATE_KEY = 'spendly_offline_pin_lock_state';
  const LS_PERSONA_KEY    = 'spendly_persona';
  const LS_ONBOARDED_KEY  = 'spendly_onboarded';
  // Signed-in financial data is server-backed; anonymous offline data uses a separate local-only key.

  // API base — auto-detects dev vs production
  const isDevHost = ['localhost', '127.0.0.1', '0.0.0.0', ''].includes(window.location.hostname);
  const API_BASE  = isDevHost ? `http://${window.location.hostname || 'localhost'}:5000/api` : '/api';



  // Smart suggestion map: amount → category
  const SMART_SUGGESTIONS = {
    '1800': 'Rent',
    '2800': 'Mess',
    '100':  'Router',
  };

  // Category emoji map
  const CATEGORY_EMOJI = {
    'Rent':          '🏠',
    'Mess':          '🍱',
    'Router':        '📡',
    'Gym':           '💪',
    'Stationery':    '📝',
    'Sunday Dinner': '🍽️',
    'Groceries':     '🛒',
    'Transport':     '🚌',
    'Entertainment': '🎬',
    'Custom':        '✏️',
  };

  /* ══════════════════════════════════════════
     API LAYER — Backend communications
  ══════════════════════════════════════════ */

  function getAuthToken() {
    let token = sessionStorage.getItem('spendly_auth_token');
    if (token) return token;
    // One-time migration for sessions created before tokens moved to tab-scoped storage.
    token = localStorage.getItem('spendly_auth_token');
    if (token) {
      sessionStorage.setItem('spendly_auth_token', token);
      localStorage.removeItem('spendly_auth_token');
    }
    return token;
  }

  async function authFetch(url, options = {}) {
    const token = getAuthToken();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, Object.assign({}, options, { headers }));
    if (token && (response.status === 401 || response.status === 403)) {
      sessionStorage.removeItem('spendly_auth_token');
      localStorage.removeItem('spendly_auth_token');
      localStorage.removeItem('spendly_user');
      clearUserCache();
      window.location.href = 'login.html';
    }
    return response;
  }

  /* ══════════════════════════════════════════
     IN-MEMORY CACHE (populated from backend)
  ══════════════════════════════════════════ */
  let _wallets      = [];  // [{id, user_id, name, type, balance, is_default}]
  let _transactions = [];  // [{id, wallet_id, type, amount, category, ...}]
  let _khata        = [];  // [{id, friend_name, original_amount, outstanding, repayments, ...}]
  let _currentUser  = null;

  function offlineStorageKey() {
    if (isAuthenticated()) return _currentUser ? `spendly_local_data_${_currentUser.id}` : null;
    return 'spendly_offline_local';
  }

  // Local-only data is kept separate from each signed-in account's server records.
  function getOfflineDB() {
    const empty = { currentCashBalance: 0, currentOnlineBalance: 0, transactions: [], pendingLiabilities: [], lentRecords: [] };
    const key = offlineStorageKey();
    if (!key) return empty;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
      return {
        currentCashBalance: centsToAmount(amountToCents(data.currentCashBalance || 0)),
        currentOnlineBalance: centsToAmount(amountToCents(data.currentOnlineBalance || 0)),
        transactions: Array.isArray(data.transactions) ? data.transactions.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [],
        pendingLiabilities: Array.isArray(data.pendingLiabilities) ? data.pendingLiabilities.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [],
        lentRecords: Array.isArray(data.lentRecords) ? data.lentRecords.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [],
      };
    }
    catch { return empty; }
  }
  function saveOfflineDB(d) {
    const key = offlineStorageKey();
    if (key) localStorage.setItem(key, JSON.stringify(d));
  }
  function initDB() {}  // no-op kept for compatibility
  function getDB()   { return getOfflineDB(); }
  function saveDB(d) { saveOfflineDB(d); }

  // Wipe user-specific financial cache on logout / account switch
  function clearUserCache() {
    _wallets      = [];
    _transactions = [];
    _khata        = [];
    _currentUser  = null;
  }

  function isAuthenticated() { return !!getAuthToken(); }

  /* Load all data from backend into the cache */
  async function loadServerData() {
    if (!isAuthenticated()) return false;
    try {
      const [meRes, wRes, tRes, kRes] = await Promise.all([
        authFetch(`${API_BASE}/me`),
        authFetch(`${API_BASE}/wallets`),
        authFetch(`${API_BASE}/transactions`),
        authFetch(`${API_BASE}/khata`),
      ]);
      if (!meRes.ok || !wRes.ok || !tRes.ok || !kRes.ok) {
        // Token may be expired — redirect to login
        if ([meRes, wRes, tRes, kRes].some(response => response.status === 401 || response.status === 403)) {
          clearUserCache();
          sessionStorage.removeItem('spendly_auth_token');
          localStorage.removeItem('spendly_auth_token');
          localStorage.removeItem('spendly_user');
          window.location.href = 'login.html';
          return false;
        }
        return false;
      }
      const userData = await meRes.json();
      const wData = await wRes.json();
      const tData = await tRes.json();
      const kData = await kRes.json();
      _currentUser  = userData.user || null;
      _wallets      = wData.wallets      || [];
      _transactions = tData.transactions || [];
      _khata        = kData.records      || [];
      return true;
    } catch (e) {
      console.warn('[loadServerData] Network error, running offline:', e.message);
      return false;
    }
  }

  /* Helpers to look up wallet IDs by type */
  function getWalletByType(type) {
    return _wallets.find(w => w.type === type) || null;
  }

  function amountToCents(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(Number(value))) return 0;
    const numeric = Number(value);
    if (numeric < 0) return 0;
    const scaled = numeric * 100;
    const cents = Math.trunc(scaled + 0.5);
    return Number.isSafeInteger(cents) && Math.abs(scaled - cents) <= 0.000001 ? cents : 0;
  }

  function inputAmountToCents(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) return null;
    const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
    return Number.isSafeInteger(cents) ? cents : null;
  }

  function centsToAmount(cents) { return cents / 100; }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function getTotalBalances() {
    if (isAuthenticated() && _wallets.length) {
      const cashCents = _wallets.filter(w => w.type === 'cash').reduce((sum, wallet) => sum + amountToCents(wallet.balance), 0);
      const onlineCents = _wallets.filter(w => w.type === 'online').reduce((sum, wallet) => sum + amountToCents(wallet.balance), 0);
      return { cash: cashCents / 100, online: onlineCents / 100, total: (cashCents + onlineCents) / 100 };
    }
    if (isAuthenticated()) return { cash: 0, online: 0, total: 0 };
    // Offline path
    const db = getOfflineDB();
    const cashCents = amountToCents(db.currentCashBalance || 0);
    const onlineCents = amountToCents(db.currentOnlineBalance || 0);
    return { cash: centsToAmount(cashCents), online: centsToAmount(onlineCents), total: centsToAmount(cashCents + onlineCents) };
  }



  /* ══════════════════════════════════════════
     APP STATE
  ══════════════════════════════════════════ */
  let pinBuffer       = '';
  let offlinePinState = loadOfflinePinState();
  let pinLockTimer    = null;
  let selectedPersona = null;
  let activeWallet    = null; // 'cash' | 'online'
  let expWallet       = 'cash'; // selected wallet in expense modal
  let calViewDate     = new Date(); // month shown in calendar
  let calFilterDay    = null;       // selected day string 'YYYY-MM-DD' or null

  /* ══════════════════════════════════════════
     DOM REFERENCES
  ══════════════════════════════════════════ */
  const splash           = document.getElementById('splash');
  const pinScreen        = document.getElementById('pin-screen');
  const onboardingScreen = document.getElementById('onboarding-screen');
  const dashboardScreen  = document.getElementById('dashboard-screen');
  const pinDotsEl        = document.getElementById('pin-dots');
  const pinErrorEl       = document.getElementById('pin-error');
  const dots             = Array.from(document.querySelectorAll('.pin-dot'));
  const personaCards     = Array.from(document.querySelectorAll('.persona-card'));
  const onboardingCta    = document.getElementById('onboarding-cta');
  const headerMonthEl    = document.getElementById('header-month-text');
  const personaPillEl    = document.getElementById('persona-display-pill');
  const avatarEl         = document.getElementById('avatar-btn');

  // Balance display
  const totalBalanceEl  = document.getElementById('total-balance-display');
  const cashBalanceEl   = document.getElementById('cash-balance-display');
  const onlineBalanceEl = document.getElementById('online-balance-display');

  // Modal
  const modalOverlay    = document.getElementById('add-balance-modal');
  const sheetTitleEl    = document.getElementById('sheet-title');
  const sheetSubtitleEl = document.getElementById('sheet-subtitle');
  const amountInput     = document.getElementById('balance-amount-input');
  const confirmBtn      = document.getElementById('sheet-confirm-btn');
  const quickAmounts    = document.querySelectorAll('.quick-amt');

  // Toast
  const toastEl = document.getElementById('app-toast');

  // Expense modal
  const expModal       = document.getElementById('expense-modal');
  const expFab         = document.getElementById('expense-fab');
  const expAmountInput = document.getElementById('exp-amount');
  const expCategory    = document.getElementById('exp-category');
  const expNotes       = document.getElementById('exp-notes');
  const expSaveBtn     = document.getElementById('exp-save-btn');
  const suggPill       = document.getElementById('suggestion-pill');
  const balWarn        = document.getElementById('balance-warning');
  const toggleCash     = document.getElementById('toggle-cash');
  const toggleOnline   = document.getElementById('toggle-online');
  const txnEmptyEl     = document.getElementById('transactions-empty');
  const txnListEl      = document.getElementById('txn-list');

  // Phase 4 — split & calendar
  const expSplitChk    = document.getElementById('exp-split');
  const splitInfoPanel = document.getElementById('split-info-panel');
  const splitNowAmt    = document.getElementById('split-now-amt');
  const splitLaterAmt  = document.getElementById('split-later-amt');
  const dashboardBody  = document.getElementById('dashboard-body');
  const calGrid        = document.getElementById('cal-grid');
  const calMonthLabel  = document.getElementById('cal-month-label');
  const calFilterLabel = document.getElementById('cal-filter-label');
  const calFilterText  = document.getElementById('cal-filter-date-text');
  const calClearBtn    = document.getElementById('cal-clear-btn');
  const calTxnList     = document.getElementById('cal-txn-list');
  const calTxnEmpty    = document.getElementById('cal-txn-empty');
  const calTxnTitle    = document.getElementById('cal-txn-title');
  const calPrev        = document.getElementById('cal-prev');
  const calNext        = document.getElementById('cal-next');

  // Phase 5 — Khata
  const expKhataChk      = document.getElementById('exp-khata');
  const khataFriendField = document.getElementById('khata-friend-field');
  const expFriendName    = document.getElementById('exp-friend-name');
  const khataSection     = document.getElementById('khata-section');
  const khataList        = document.getElementById('khata-list');
  const khataClearBtn    = document.getElementById('khata-clear-btn');

  // Phase 5 — Settings / Data
  const importFileInput  = document.getElementById('import-file-input');

  /* ══════════════════════════════════════════
     SCREEN TRANSITIONS
  ══════════════════════════════════════════ */
  function showScreen(screenEl, fromEl) {
    if (fromEl) {
      fromEl.classList.add('exit-up');
      fromEl.classList.remove('active');
      setTimeout(() => fromEl.classList.remove('exit-up'), 500);
    }
    requestAnimationFrame(() => screenEl.classList.add('active'));
  }

  /* ══════════════════════════════════════════
     SPLASH → FIRST SCREEN
  ══════════════════════════════════════════ */
  function hideSplashAndStart() {
    splash.classList.add('hidden');
    setTimeout(async () => {
      splash.style.display = 'none';
      const authToken = getAuthToken();
      if (authToken) {
        const loaded = await loadServerData();
        loadDashboard();
        dashboardScreen.classList.add('active');
        if (!loaded && isAuthenticated()) showToast('Account data is unavailable while offline. Reconnect to load your signed-in data.', 'error');
      } else {
        pinScreen.classList.add('active');
        showOfflinePinLockState();
      }
    }, 520);
  }


  /* ══════════════════════════════════════════
     NUMBER FORMATTER
  ══════════════════════════════════════════ */
  function fmt(num) {
    const val = typeof num === 'number' ? num : Number(num) || 0;
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  }

  /* ══════════════════════════════════════════
     BALANCE DISPLAY — Reactive Update
  ══════════════════════════════════════════ */
  function refreshBalanceDisplay() {
    const { cash, online, total } = getTotalBalances();
    animateCounter(totalBalanceEl,  total);
    animateCounter(cashBalanceEl,   cash);
    animateCounter(onlineBalanceEl, online);
  }

  function animateCounter(el, targetVal) {
    const start    = Number(el.textContent.replace(/,/g, '')) || 0;
    const end      = typeof targetVal === 'number' ? targetVal : Number(targetVal) || 0;
    const duration = 500;
    const startTs  = performance.now();

    function step(ts) {
      const progress = Math.min((ts - startTs) / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current  = start + (end - start) * ease;
      el.textContent = fmt(current);
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  /* ══════════════════════════════════════════
     TOAST NOTIFICATION
  ══════════════════════════════════════════ */
  let toastTimer = null;
  function showToast(msg, type = 'success') {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = `toast ${type} show`;
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  /* ══════════════════════════════════════════
     ADD BALANCE MODAL
  ══════════════════════════════════════════ */
  function openAddBalanceModal(walletType) {
    activeWallet = walletType;
    const isCash = walletType === 'cash';

    sheetTitleEl.textContent    = isCash ? 'Add Cash' : 'Add Online Money';
    sheetSubtitleEl.textContent = isCash
      ? 'Enter the cash amount you want to add'
      : 'Enter the online / UPI amount to add';

    confirmBtn.className = `sheet-confirm-btn ${isCash ? 'cash-confirm' : 'online-confirm'}`;
    confirmBtn.textContent = `Add to ${isCash ? 'Cash' : 'Online'} Wallet`;
    confirmBtn.disabled = true;

    // Reset input & quick-select
    amountInput.value = '';
    quickAmounts.forEach(q => q.classList.remove('selected'));

    modalOverlay.classList.add('open');
    setTimeout(() => amountInput.focus(), 350);
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
    activeWallet = null;
    amountInput.value = '';
    quickAmounts.forEach(q => q.classList.remove('selected'));
    confirmBtn.disabled = true;
  }

  // Open via wallet card buttons
  document.getElementById('add-cash-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openAddBalanceModal('cash');
  });
  document.getElementById('add-online-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openAddBalanceModal('online');
  });

  // Close when clicking overlay backdrop
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
  });

  // Quick amount chips
  quickAmounts.forEach(chip => {
    chip.addEventListener('click', () => {
      quickAmounts.forEach(q => q.classList.remove('selected'));
      chip.classList.add('selected');
      amountInput.value = chip.dataset.amount;
      confirmBtn.disabled = false;
    });
  });

  // Input validation
  amountInput.addEventListener('input', () => {
    const cents = inputAmountToCents(amountInput.value);
    confirmBtn.disabled = !(cents > 0);
    if (!amountInput.value) {
      quickAmounts.forEach(q => q.classList.remove('selected'));
    }
  });

  // Confirm — call deposit API or write offline
  confirmBtn.addEventListener('click', async () => {
    const amountCents = inputAmountToCents(amountInput.value);
    if (!(amountCents > 0)) return;
    const amount = centsToAmount(amountCents);
    if (confirmBtn.disabled) return;

    // Prevent duplicate submission
    confirmBtn.disabled = true;
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = 'Adding…';

    if (isAuthenticated()) {
      try {
        const wallet = getWalletByType(activeWallet);
        if (!wallet) { showToast('⚠ Wallet not found', 'error'); confirmBtn.disabled = false; confirmBtn.textContent = originalText; return; }
        const res = await authFetch(`${API_BASE}/wallets/${wallet.id}/deposit`, {
          method: 'POST',
          body: JSON.stringify({ amount })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to add funds');
        // Update local cache
        const idx = _wallets.findIndex(w => w.id === wallet.id);
        if (idx !== -1) _wallets[idx] = data.wallet;
        const label = activeWallet === 'cash' ? 'Cash Wallet' : 'Online Wallet';
        showToast(`✓ ₹${fmt(amount)} added to ${label}`);
        closeModal();
        refreshBalanceDisplay();
      } catch (err) {
        showToast(`✗ ${err.message}`, 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
      }
    } else {
      // Offline path
      const db = getDB();
      if (activeWallet === 'cash') {
        db.currentCashBalance = centsToAmount(amountToCents(db.currentCashBalance || 0) + amountCents);
      } else {
        db.currentOnlineBalance = centsToAmount(amountToCents(db.currentOnlineBalance || 0) + amountCents);
      }
      saveDB(db);
      const label = activeWallet === 'cash' ? 'Cash Wallet' : 'Online Wallet';
      showToast(`✓ ₹${fmt(amount)} added to ${label}`);
      closeModal();
      refreshBalanceDisplay();
    }
  });



  /* ══════════════════════════════════════════
     PIN LOGIC
  ══════════════════════════════════════════ */
  // The offline PIN is a local app lock only; server data requires a valid account session.
  function loadOfflinePinState() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(OFFLINE_PIN_STATE_KEY));
      if (!stored || typeof stored !== 'object') return { failures: 0, lockedUntil: 0 };
      const failures = Number.isSafeInteger(stored.failures) && stored.failures >= 0 ? stored.failures : 0;
      const lockedUntil = Number.isSafeInteger(stored.lockedUntil) && stored.lockedUntil > Date.now() ? stored.lockedUntil : 0;
      return { failures: lockedUntil ? failures : 0, lockedUntil };
    } catch {
      return { failures: 0, lockedUntil: 0 };
    }
  }

  function saveOfflinePinState() {
    sessionStorage.setItem(OFFLINE_PIN_STATE_KEY, JSON.stringify(offlinePinState));
  }

  function clearOfflinePinState() {
    offlinePinState = { failures: 0, lockedUntil: 0 };
    sessionStorage.removeItem(OFFLINE_PIN_STATE_KEY);
    clearTimeout(pinLockTimer);
    pinLockTimer = null;
  }

  function isOfflinePinLocked() {
    if (offlinePinState.lockedUntil <= Date.now()) {
      if (offlinePinState.lockedUntil) clearOfflinePinState();
      return false;
    }
    return true;
  }

  function showOfflinePinLockState() {
    if (!isOfflinePinLocked()) return false;
    const seconds = Math.max(1, Math.ceil((offlinePinState.lockedUntil - Date.now()) / 1000));
    pinErrorEl.textContent = `Too many attempts. Try again in ${seconds} seconds.`;
    pinErrorEl.classList.add('show');
    clearTimeout(pinLockTimer);
    pinLockTimer = setTimeout(showOfflinePinLockState, Math.min(1000, offlinePinState.lockedUntil - Date.now() + 1));
    return true;
  }

  function updateDots() {
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < pinBuffer.length);
      dot.classList.remove('error');
    });
  }

  function pinSuccess() {
    clearOfflinePinState();
    dots.forEach(d => d.classList.add('filled'));
    setTimeout(() => {
      const isOnboarded = localStorage.getItem(LS_ONBOARDED_KEY);
      if (isOnboarded) {
        loadDashboard();
        showScreen(dashboardScreen, pinScreen);
      } else {
        showScreen(onboardingScreen, pinScreen);
      }
      pinBuffer = '';
      updateDots();
    }, 400);
  }

  function pinError() {
    offlinePinState.failures += 1;
    if (offlinePinState.failures >= OFFLINE_PIN_MAX_ATTEMPTS) {
      offlinePinState = { failures: 0, lockedUntil: Date.now() + OFFLINE_PIN_LOCK_MS };
    }
    saveOfflinePinState();
    dots.forEach(d => d.classList.add('error'));
    pinDotsEl.classList.add('shake');
    const locked = isOfflinePinLocked();
    pinErrorEl.textContent = locked ? 'Too many attempts. Try again shortly.' : 'Incorrect offline app PIN. Try again.';
    pinErrorEl.classList.add('show');
    setTimeout(() => {
      pinDotsEl.classList.remove('shake');
      pinBuffer = '';
      updateDots();
      if (locked) showOfflinePinLockState();
      else setTimeout(() => pinErrorEl.classList.remove('show'), 800);
    }, 500);
  }

  function handleKeyPress(digit) {
    if (showOfflinePinLockState()) return;
    if (pinBuffer.length >= 4) return;
    pinBuffer += digit;
    updateDots();
    if (pinBuffer.length === 4) {
      pinBuffer === OFFLINE_APP_PIN ? pinSuccess() : setTimeout(pinError, 80);
    }
  }

  function handleDelete() {
    if (pinBuffer.length === 0) return;
    pinBuffer = pinBuffer.slice(0, -1);
    updateDots();
    pinErrorEl.classList.remove('show');
  }

  document.querySelectorAll('.key-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', function (e) {
      addRipple(this, e);
      handleKeyPress(this.dataset.key);
    });
  });

  document.getElementById('key-del').addEventListener('click', function (e) {
    addRipple(this, e);
    handleDelete();
  });

  document.addEventListener('keydown', (e) => {
    if (!pinScreen.classList.contains('active')) return;
    if (/^[0-9]$/.test(e.key)) handleKeyPress(e.key);
    if (e.key === 'Backspace') handleDelete();
  });

  /* ══════════════════════════════════════════
     ONBOARDING LOGIC
  ══════════════════════════════════════════ */
  personaCards.forEach(card => {
    function selectCard() {
      personaCards.forEach(c => {
        c.classList.remove('selected');
        c.setAttribute('aria-checked', 'false');
      });
      card.classList.add('selected');
      card.setAttribute('aria-checked', 'true');
      selectedPersona = card.dataset.persona;
      onboardingCta.disabled = false;
    }
    card.addEventListener('click', selectCard);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCard(); }
    });
  });

  onboardingCta.addEventListener('click', () => {
    if (!selectedPersona) return;
    localStorage.setItem(LS_PERSONA_KEY, selectedPersona);
    localStorage.setItem(LS_ONBOARDED_KEY, 'true');
    loadDashboard();
    showScreen(dashboardScreen, onboardingScreen);
  });

  /* ══════════════════════════════════════════
     DASHBOARD LOAD
  ══════════════════════════════════════════ */
  function loadDashboard() {
    // Header month/year
    const now    = new Date();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    headerMonthEl.innerHTML = `${months[now.getMonth()]} <span>${now.getFullYear()}</span>`;

    // Persona pill + avatar
    const storedUser = isAuthenticated() ? _currentUser : null;

    const persona = localStorage.getItem(LS_PERSONA_KEY) || 'Student';
    const personaMap = {
      'Student':        { emoji: '🎓', cls: 'student' },
      'Salaried':       { emoji: '💼', cls: 'salaried' },
      'Business Owner': { emoji: '🏢', cls: 'business' },
    };
    const pm = personaMap[persona] || personaMap['Student'];
    if (storedUser && storedUser.name) {
      personaPillEl.className   = `persona-pill student`;
      personaPillEl.textContent = `👤 ${storedUser.name}`;
      avatarEl.textContent      = storedUser.name.charAt(0).toUpperCase();
    } else {
      personaPillEl.className   = `persona-pill ${pm.cls}`;
      personaPillEl.textContent = `${pm.emoji} ${persona}`;
      avatarEl.textContent      = '👤';
    }

    // Load & display balances from DB
    refreshBalanceDisplay();
    renderTransactions();
    renderKhata();
  }

  /* ══════════════════════════════════════════
     PHASE 3 — EXPENSE MODAL
  ══════════════════════════════════════════ */

  function openExpenseModal() {
    expAmountInput.value   = '';
    expSplitChk.checked    = false;
    expKhataChk.checked    = false;
    khataFriendField.classList.remove('visible');
    splitInfoPanel.classList.remove('visible');
    expCategory.value    = '';
    expNotes.value       = '';
    expFriendName.value  = '';
    expWallet            = 'cash';
    suggPill.classList.remove('visible');
    balWarn.style.display = 'none';
    setExpWallet('cash');
    expModal.classList.add('open');
    expFab.classList.add('open');
    setTimeout(() => expAmountInput.focus(), 350);
  }

  function closeExpenseModal() {
    expModal.classList.remove('open');
    expFab.classList.remove('open');
  }

  // FAB
  expFab.addEventListener('click', () => {
    if (expModal.classList.contains('open')) { closeExpenseModal(); }
    else { openExpenseModal(); }
  });

  // Also hook "Add First Expense" empty-state button
  document.getElementById('add-first-btn').addEventListener('click', openExpenseModal);
  document.querySelectorAll('#qa-add').forEach(el => el.addEventListener('click', openExpenseModal));

  // Close on backdrop click
  expModal.addEventListener('click', (e) => {
    if (e.target === expModal) closeExpenseModal();
  });

  // Wallet toggle
  function setExpWallet(type) {
    expWallet = type;
    toggleCash.className   = 'wallet-toggle-btn' + (type === 'cash'   ? ' active-cash'   : '');
    toggleOnline.className = 'wallet-toggle-btn' + (type === 'online' ? ' active-online' : '');
    toggleCash.setAttribute('aria-pressed',   String(type === 'cash'));
    toggleOnline.setAttribute('aria-pressed', String(type === 'online'));
    validateExpForm();
  }

  toggleCash.addEventListener('click',   () => setExpWallet('cash'));
  toggleOnline.addEventListener('click', () => setExpWallet('online'));

  // Smart suggestion on amount input
  expAmountInput.addEventListener('input', () => {
    const raw = expAmountInput.value.trim();
    const suggestion = SMART_SUGGESTIONS[raw];

    if (suggestion) {
      expCategory.value = suggestion;
      suggPill.classList.add('visible');
    } else {
      suggPill.classList.remove('visible');
    }
    validateExpForm();
  });

  expCategory.addEventListener('change', () => {
    suggPill.classList.remove('visible');
    validateExpForm();
  });

  expNotes.addEventListener('input', validateExpForm);

  function validateExpForm() {
    const amountCents = inputAmountToCents(expAmountInput.value);
    let balanceCents = 0;
    if (isAuthenticated() && _wallets.length) {
      const w = getWalletByType(expWallet);
      balanceCents = w ? amountToCents(w.balance) : 0;
    } else {
      const db = getDB();
      balanceCents = expWallet === 'cash'
        ? amountToCents(db.currentCashBalance || 0)
        : amountToCents(db.currentOnlineBalance || 0);
    }

    const spendCents = amountCents === null ? 0 : (!expKhataChk.checked && expSplitChk.checked ? Math.floor(amountCents / 2) + amountCents % 2 : amountCents);
    const insufficient = spendCents > 0 && spendCents > balanceCents;
    balWarn.style.display = insufficient ? 'block' : 'none';

    const valid = amountCents > 0 && expCategory.value && !insufficient;
    expSaveBtn.disabled = !valid;
  }

  // Save expense — with API sync, debounce & duplicate protection
  expSaveBtn.addEventListener('click', async () => {
    const amountCents = inputAmountToCents(expAmountInput.value);
    const amount   = amountCents === null ? 0 : centsToAmount(amountCents);
    const category = expCategory.value;
    const notes    = expNotes.value.trim();
    if (!amount || !category) return;
    if (expSaveBtn.disabled) return;

    // Prevent duplicate submission
    expSaveBtn.disabled = true;
    const originalText = expSaveBtn.textContent;
    expSaveBtn.textContent = 'Saving…';

    const isKhata    = expKhataChk.checked;
    const friendName = isKhata ? (expFriendName.value.trim() || 'Friend') : '';
    const isSplit    = !isKhata && expSplitChk.checked;
    const nowCents   = isSplit ? Math.floor(amountCents / 2) + amountCents % 2 : amountCents;
    const deferCents = isSplit ? amountCents - nowCents : 0;
    const nowAmount  = centsToAmount(nowCents);
    const deferAmt   = centsToAmount(deferCents);

    if (isAuthenticated()) {
      try {
        const wallet = getWalletByType(expWallet);
        if (!wallet) throw new Error('Target wallet not found');
        if (amountToCents(wallet.balance) < nowCents) throw new Error('Insufficient balance in selected wallet');

        if (isKhata) {
          const res = await authFetch(`${API_BASE}/khata`, {
            method: 'POST',
            body: JSON.stringify({
              wallet_id: wallet.id,
              friend_name: friendName,
              amount,
              category,
              category_emoji: CATEGORY_EMOJI[category] || '🤝',
              note: notes
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to record lent money');
        } else {
          // Record paid portion as an expense transaction
          const noteText = (notes || '') + (isSplit ? ' [50% paid]' : '');
          const res = await authFetch(`${API_BASE}/transactions`, {
            method: 'POST',
            body: JSON.stringify({
              wallet_id: wallet.id,
              type: 'expense',
              amount: nowAmount,
              category,
              category_emoji: CATEGORY_EMOJI[category] || '💳',
              note: noteText
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to record expense');

          // If split, schedule deferred liability in client cache
          if (isSplit && deferCents > 0) {
            const nextMonthFirst = new Date();
            nextMonthFirst.setDate(1);
            nextMonthFirst.setMonth(nextMonthFirst.getMonth() + 1);
            nextMonthFirst.setHours(0, 0, 0, 0);
            const offDb = getOfflineDB();
            if (!offDb.pendingLiabilities) offDb.pendingLiabilities = [];
            offDb.pendingLiabilities.unshift({
              id:         Date.now() + 1,
              dueDate:    nextMonthFirst.toISOString(),
              amount:     deferAmt,
              remainingAmount: deferAmt,
              status:     'outstanding',
              category,
              notes:      (notes || '') + ' [deferred 50%]',
              fromWallet: expWallet,
            });
            saveOfflineDB(offDb);
          }
        }

        await loadServerData();
        refreshBalanceDisplay();
        renderTransactions();
        renderKhata();
        buildCalendar();
        renderCalTxns();
        closeExpenseModal();

        const toastMsg = isKhata
          ? `🤝 ₹${fmt(amount)} lent to ${friendName}`
          : isSplit
          ? `✓ ₹${fmt(nowAmount)} paid · ₹${fmt(deferAmt)} deferred`
          : `✓ ₹${fmt(amount)} — ${category}`;
        showToast(toastMsg, isKhata || isSplit ? 'info' : 'success');
      } catch (err) {
        showToast(`✗ ${err.message}`, 'error');
      } finally {
        expSaveBtn.disabled = false;
        expSaveBtn.textContent = originalText;
      }
    } else {
      // Offline fallback
      try {
        const db = getDB();
        const balKey = expWallet === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance';
        if (amountToCents(db[balKey] || 0) < nowCents) {
          showToast('⚠ Insufficient balance!', 'error');
          return;
        }

        db[balKey] = centsToAmount(amountToCents(db[balKey] || 0) - nowCents);

        if (isKhata) {
          if (!db.lentRecords) db.lentRecords = [];
          db.lentRecords.unshift({
            id:         Date.now(),
            date:       new Date().toISOString(),
            amount,
            friendName,
            category,
            notes:      notes || '',
            wallet:     expWallet,
          });
        } else {
          const txn = {
            id:       Date.now(),
            date:     new Date().toISOString(),
            amount:   nowAmount,
            category,
            notes:    (notes || '') + (isSplit ? ' [50% paid]' : ''),
            wallet:   expWallet,
          };
          if (!db.transactions) db.transactions = [];
          db.transactions.unshift(txn);

          if (isSplit && deferCents > 0) {
            const nextMonthFirst = new Date();
            nextMonthFirst.setDate(1);
            nextMonthFirst.setMonth(nextMonthFirst.getMonth() + 1);
            nextMonthFirst.setHours(0, 0, 0, 0);
            if (!db.pendingLiabilities) db.pendingLiabilities = [];
            db.pendingLiabilities.unshift({
              id:         Date.now() + 1,
              dueDate:    nextMonthFirst.toISOString(),
              amount:     deferAmt,
              remainingAmount: deferAmt,
              status:     'outstanding',
              category,
              notes:      (notes || '') + ' [deferred 50%]',
              fromWallet: expWallet,
            });
          }
        }

        saveDB(db);
        refreshBalanceDisplay();
        renderTransactions();
        renderKhata();
        buildCalendar();
        renderCalTxns();
        closeExpenseModal();

        const toastMsg = isKhata
          ? `🤝 ₹${fmt(amount)} lent to ${friendName}`
          : isSplit
          ? `✓ ₹${fmt(nowAmount)} paid · ₹${fmt(deferAmt)} deferred`
          : `✓ ₹${fmt(amount)} — ${category}`;
        showToast(toastMsg, isKhata || isSplit ? 'info' : 'success');
      } finally {
        expSaveBtn.disabled = false;
        expSaveBtn.textContent = originalText;
      }
    }
  });

  /* ══════════════════════════════════════════
     TRANSACTION RENDERER & ACTIONS
  ══════════════════════════════════════════ */
  function formatDate(iso) {
    if (!iso) return 'Unknown date';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return 'Unknown date';
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString())     return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
  }

  function liabilityOutstandingCents(item) {
    if (!item || item.status === 'settled') return 0;
    return amountToCents(item.remainingAmount === undefined ? item.amount : item.remainingAmount);
  }

  function mapPendingLiability(item) {
    const outstandingCents = liabilityOutstandingCents(item);
    return {
      ...item,
      _type: 'pending',
      _outstandingCents: outstandingCents,
      _settled: item.status === 'settled' || outstandingCents === 0,
      date: item.dueDate
    };
  }

  function getAllTransactionItems() {
    if (isAuthenticated()) {
      const txns = _transactions.map(t => ({
        id: t.id,
        date: t.transaction_date,
        amount: t.amount,
        category: t.category,
        category_emoji: t.category_emoji,
        notes: t.note,
        wallet: t.wallet_type || 'cash',
        type: t.type || 'expense',
        transfer_id: t.transfer_id || null,
        import_key: t.import_key || null,
        _type: 'txn'
      }));
      const offDb = getOfflineDB();
      const pending = (offDb.pendingLiabilities || []).map(mapPendingLiability);
      return [...txns, ...pending].sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    const db = getDB();
    const txns = (db.transactions || []).map(t => ({ ...t, _type: 'txn' }));
    const pending = (db.pendingLiabilities || []).map(mapPendingLiability);
    return [...txns, ...pending].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async function deleteTransaction(txId, itemType) {
    if (itemType === 'pending') {
      showToast('Deferred expense history is kept. Use Pay to settle the outstanding amount.', 'info');
      return;
    }

    const serverTx = isAuthenticated() ? _transactions.find(item => String(item.id) === String(txId)) : null;
    const offlineTx = !isAuthenticated() ? (getDB().transactions || []).find(item => String(item.id) === String(txId)) : null;
    const protectedSettlement = isAuthenticated()
      ? !!(serverTx && (String(serverTx.import_key || '').startsWith('deferred-settlement:') || String(serverTx.note || '').startsWith('Spendly deferred settlement:')))
      : !!(offlineTx && String(offlineTx.notes || '').startsWith('Spendly deferred settlement:'));
    if (protectedSettlement) {
      showToast('Settled deferred expense payments cannot be deleted.', 'error');
      return;
    }
    const isTransfer = isAuthenticated()
      ? !!(serverTx && (serverTx.transfer_id || serverTx.category === 'Transfer Out' || serverTx.category === 'Transfer In'))
      : !!(offlineTx && (offlineTx.transfer_id || offlineTx.category === 'Transfer Out' || offlineTx.category === 'Transfer In'));
    if (!confirm(isTransfer
      ? 'Delete both sides of this wallet transfer and restore both balances?'
      : 'Delete this transaction? The amount will be refunded to your wallet.')) return;

    if (isAuthenticated()) {
      try {
        const res = await authFetch(`${API_BASE}/transactions/${txId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete transaction');
        await loadServerData();
        refreshBalanceDisplay();
        renderTransactions();
        buildCalendar();
        renderCalTxns();
        showToast(data.message || 'Transaction deleted and balance restored.');
      } catch (err) {
        showToast(`✗ ${err.message}`, 'error');
      }
    } else {
      const db = getDB();
      const idx = (db.transactions || []).findIndex(t => String(t.id) === String(txId));
      if (idx !== -1) {
        const tx = db.transactions[idx];
        let rows = [tx];
        if (tx.transfer_id || tx.category === 'Transfer Out' || tx.category === 'Transfer In') {
          rows = (db.transactions || []).filter(item => tx.transfer_id && item.transfer_id === tx.transfer_id);
          if (rows.length !== 2) {
            showToast('This transfer is incomplete and cannot be safely removed.', 'error');
            return;
          }
        }
        const changes = new Map();
        for (const row of rows) {
          const key = row.wallet === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance';
          const change = row.type === 'income' ? -amountToCents(row.amount) : amountToCents(row.amount);
          changes.set(key, (changes.get(key) || 0) + change);
        }
        for (const [key, change] of changes) {
          if (amountToCents(db[key] || 0) + change < 0) {
            showToast('This deletion would make a wallet balance negative.', 'error');
            return;
          }
        }
        for (const [key, change] of changes) db[key] = centsToAmount(amountToCents(db[key] || 0) + change);
        const deletedIds = new Set(rows.map(row => String(row.id)));
        db.transactions = (db.transactions || []).filter(item => !deletedIds.has(String(item.id)));
        saveDB(db);
        refreshBalanceDisplay();
        renderTransactions();
        buildCalendar();
        renderCalTxns();
        showToast('✓ Transaction deleted & balance restored');
      }
    }
  }

  function renderTransactions() {
    const allItems = getAllTransactionItems().slice(0, 20);
    if (allItems.length === 0) {
      txnEmptyEl.style.display = 'flex';
      txnListEl.innerHTML = '';
      return;
    }
    txnEmptyEl.style.display = 'none';
    txnListEl.innerHTML = allItems.map((t, i) => {
      const isPending = t._type === 'pending';
      const emoji = t.category_emoji || CATEGORY_EMOJI[t.category] || '\u{1F4B0}';
      const walletKey = t.wallet || t.fromWallet || 'cash';
      const walletLabel = walletKey === 'cash' ? 'Cash' : 'Online';
      const dateStr = formatDate(t.date);
      const noteStr = t.notes ? ` \u00B7 ${escapeHtml(t.notes)}` : '';
      const badge = isPending
        ? (t._settled
          ? `<div class="txn-pending-badge txn-settled-badge">Settled${t.settlementWallet ? ` \u00B7 paid from ${t.settlementWallet === 'online' ? 'Online' : 'Cash'}` : ''}</div>`
          : `<div class="txn-pending-badge">Outstanding \u00B7 Due ${formatDate(t.date)}</div>`)
        : '';
      const amountText = isPending
        ? `Outstanding \u20B9${fmt(centsToAmount(t._outstandingCents))}`
        : `${t.type === 'income' ? '+' : '\u2212'}\u20B9${fmt(t.amount)}`;
      const amountClass = isPending ? 'txn-amount pending-amt' : 'txn-amount';
      const isProtectedSettlement = !isPending && ((t.import_key || '').startsWith('deferred-settlement:') || (t.notes || '').startsWith('Spendly deferred settlement:'));
      return `
        <div class="txn-item${isPending ? ' pending' : ''}" style="animation-delay:${i * 0.04}s">
          <div class="txn-icon">${escapeHtml(emoji)}</div>
          <div class="txn-details">
            <div class="txn-category">${escapeHtml(t.category)}</div>
            ${badge}
            <div class="txn-meta">
              <span class="txn-wallet-dot ${walletKey === 'cash' ? 'cash' : 'online'}"></span>
              ${walletLabel}${noteStr} \u00B7 ${dateStr}
            </div>
          </div>
          <div class="txn-actions">
            <div class="${amountClass}"${t.type === 'income' ? ' style="color:var(--success)"' : ''}>${amountText}</div>
            ${isPending && !t._settled ? `<button class="txn-deferred-pay-btn" data-id="${escapeHtml(t.id)}" type="button" aria-label="Pay outstanding \u20B9${fmt(centsToAmount(t._outstandingCents))} for ${escapeHtml(t.category)}">Pay \u20B9${fmt(centsToAmount(t._outstandingCents))}</button>` : ''}
          </div>
          ${!isPending && !isProtectedSettlement ? `<button class="txn-delete-btn" data-id="${escapeHtml(t.id)}" data-type="txn" aria-label="Delete transaction" title="Delete & refund balance">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>` : ''}
        </div>
      `;
    }).join('');
    txnListEl.querySelectorAll('.txn-delete-btn').forEach(btn => {
      btn.addEventListener('click', async event => {
        event.stopPropagation();
        await deleteTransaction(btn.dataset.id, btn.dataset.type);
      });
    });
    txnListEl.querySelectorAll('.txn-deferred-pay-btn').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        openDeferredPayModal(btn.dataset.id);
      });
    });
  }

  /* ══════════════════════════════════════════
     PHASE 4A — SPLIT PAYMENT
  ══════════════════════════════════════════ */
  expSplitChk.addEventListener('change', () => {
    const amountCents = inputAmountToCents(expAmountInput.value) || 0;
    if (expSplitChk.checked) {
      splitInfoPanel.classList.add('visible');
      updateSplitPreview(amountCents);
    } else {
      splitInfoPanel.classList.remove('visible');
    }
    validateExpForm();
  });

  // Also update split preview when amount changes while split is checked
  expAmountInput.addEventListener('input', () => {
    if (expSplitChk.checked) {
      updateSplitPreview(inputAmountToCents(expAmountInput.value) || 0);
    }
  }, true); // capture = true so it runs before the existing listener

  function updateSplitPreview(amountCents) {
    const nowCents = Math.floor(amountCents / 2) + amountCents % 2;
    splitNowAmt.textContent   = `₹${fmt(centsToAmount(nowCents))}`;
    splitLaterAmt.textContent = `₹${fmt(centsToAmount(amountCents - nowCents))}`;
  }

  /* ══════════════════════════════════════════
     PHASE 4B — CALENDAR VIEW
  ══════════════════════════════════════════ */
  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  function toYMD(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function buildCalendar() {
    const year    = calViewDate.getFullYear();
    const month   = calViewDate.getMonth();
    const today   = new Date();

    calMonthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;

    // Collect days that have transactions in this month
    const expenseDays = new Set();
    getAllTransactionItems().forEach(t => {
      const d = new Date(t.date || t.dueDate);
      if (d.getFullYear() === year && d.getMonth() === month) {
        expenseDays.add(d.getDate());
      }
    });

    const firstDay   = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth= new Date(year, month + 1, 0).getDate();

    let html = '';
    // Empty leading cells
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="cal-day empty"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd        = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday    = (d === today.getDate() && month === today.getMonth() && year === today.getFullYear());
      const hasExp     = expenseDays.has(d);
      const isSelected = (calFilterDay === ymd);
      const cls = [
        'cal-day',
        isToday    ? 'today'       : '',
        hasExp     ? 'has-expense' : '',
        isSelected ? 'selected'    : '',
      ].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-ymd="${ymd}" role="gridcell" aria-label="${d} ${MONTH_NAMES[month]}" tabindex="0">
        <span class="cal-day-num">${d}</span>
        <span class="cal-dot"></span>
      </div>`;
    }
    calGrid.innerHTML = html;

    // Day click → filter
    calGrid.querySelectorAll('.cal-day:not(.empty)').forEach(cell => {
      cell.addEventListener('click', () => {
        const ymd = cell.dataset.ymd;
        if (calFilterDay === ymd) {
          calFilterDay = null;
        } else {
          calFilterDay = ymd;
        }
        buildCalendar();
        renderCalTxns();
      });
      cell.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          cell.click();
        }
      });
    });

    // Filter label
    if (calFilterDay) {
      const parts = calFilterDay.split('-');
      const d = new Date(+parts[0], +parts[1]-1, +parts[2]);
      calFilterText.textContent = d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'long' });
      calFilterLabel.style.display = 'flex';
      calFilterLabel.style.alignItems = 'center';
      calFilterLabel.style.justifyContent = 'center';
    } else {
      calFilterLabel.style.display = 'none';
    }
  }

  function renderCalTxns() {
    let txns = getAllTransactionItems();
    txns = txns.filter(t => {
      const d = new Date(t.date || t.dueDate);
      return d.getFullYear() === calViewDate.getFullYear() && d.getMonth() === calViewDate.getMonth();
    });
    if (calFilterDay) {
      txns = txns.filter(t => toYMD(new Date(t.date || t.dueDate)) === calFilterDay);
      calTxnTitle.textContent = 'On This Day';
    } else {
      calTxnTitle.textContent = 'All This Month';
    }
    txns.sort((a, b) => new Date(b.date || b.dueDate) - new Date(a.date || a.dueDate));
    if (txns.length === 0) {
      calTxnEmpty.style.display = 'flex';
      calTxnList.innerHTML = '';
      return;
    }
    calTxnEmpty.style.display = 'none';
    calTxnList.innerHTML = txns.map((t, i) => {
      const emoji = t.category_emoji || CATEGORY_EMOJI[t.category] || '\u{1F4B0}';
      const walletKey = t.wallet || t.fromWallet || 'cash';
      const walletLabel = walletKey === 'cash' ? 'Cash' : 'Online';
      const dateStr = formatDate(t.date || t.dueDate);
      const noteStr = t.notes ? ` \u00B7 ${escapeHtml(t.notes)}` : '';
      const isPending = t._type === 'pending';
      const badge = isPending
        ? (t._settled
          ? `<div class="txn-pending-badge txn-settled-badge">Settled${t.settlementWallet ? ` \u00B7 paid from ${t.settlementWallet === 'online' ? 'Online' : 'Cash'}` : ''}</div>`
          : '<div class="txn-pending-badge">Outstanding</div>')
        : '';
      const amountText = isPending
        ? `Outstanding \u20B9${fmt(centsToAmount(t._outstandingCents))}`
        : `${t.type === 'income' ? '+' : '\u2212'}\u20B9${fmt(t.amount)}`;
      const amountClass = isPending ? 'txn-amount pending-amt' : 'txn-amount';
      const isProtectedSettlement = !isPending && ((t.import_key || '').startsWith('deferred-settlement:') || (t.notes || '').startsWith('Spendly deferred settlement:'));
      return `
        <div class="txn-item${isPending ? ' pending' : ''}" style="animation-delay:${i * 0.04}s">
          <div class="txn-icon">${escapeHtml(emoji)}</div>
          <div class="txn-details">
            <div class="txn-category">${escapeHtml(t.category)}</div>
            ${badge}
            <div class="txn-meta">
              <span class="txn-wallet-dot ${walletKey === 'cash' ? 'cash' : 'online'}"></span>
              ${walletLabel}${noteStr} \u00B7 ${dateStr}
            </div>
          </div>
          <div class="txn-actions">
            <div class="${amountClass}"${t.type === 'income' ? ' style="color:var(--success)"' : ''}>${amountText}</div>
            ${isPending && !t._settled ? `<button class="txn-deferred-pay-btn" data-id="${escapeHtml(t.id)}" type="button" aria-label="Pay outstanding \u20B9${fmt(centsToAmount(t._outstandingCents))} for ${escapeHtml(t.category)}">Pay \u20B9${fmt(centsToAmount(t._outstandingCents))}</button>` : ''}
          </div>
          ${!isPending && !isProtectedSettlement ? `<button class="txn-delete-btn" data-id="${escapeHtml(t.id)}" data-type="txn" aria-label="Delete transaction" title="Delete & refund balance">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>` : ''}
        </div>
      `;
    }).join('');
    calTxnList.querySelectorAll('.txn-delete-btn').forEach(btn => {
      btn.addEventListener('click', async event => {
        event.stopPropagation();
        await deleteTransaction(btn.dataset.id, btn.dataset.type);
      });
    });
    calTxnList.querySelectorAll('.txn-deferred-pay-btn').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        openDeferredPayModal(btn.dataset.id);
      });
    });
  }

  // Calendar nav
  calPrev.addEventListener('click', () => {
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1);
    calFilterDay = null;
    buildCalendar();
    renderCalTxns();
  });
  calNext.addEventListener('click', () => {
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);
    calFilterDay = null;
    buildCalendar();
    renderCalTxns();
  });

  calClearBtn.addEventListener('click', () => {
    calFilterDay = null;
    buildCalendar();
    renderCalTxns();
  });

  // Bottom navigation switches complete, mutually exclusive dashboard pages.
  const appPages = Array.from(document.querySelectorAll('.app-page[data-app-page]'));
  const navItems = Array.from(document.querySelectorAll('.nav-item[data-page]'));

  function navigateToPage(pageName) {
    const page = appPages.find(item => item.dataset.appPage === pageName);
    if (!page) return;

    appPages.forEach(item => {
      const isActive = item === page;
      item.hidden = !isActive;
      item.setAttribute('aria-hidden', String(!isActive));
    });
    navItems.forEach(item => {
      const isActive = item.dataset.page === pageName;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    if (pageName === 'transactions') renderTransactions();
    if (pageName === 'calendar') {
      calViewDate = new Date();
      calFilterDay = null;
      buildCalendar();
      renderCalTxns();
    }
    if (pageName === 'khata') renderKhata();
    dashboardBody.scrollTop = 0;
  }

  navItems.forEach(item => item.addEventListener('click', () => navigateToPage(item.dataset.page)));
  document.getElementById('avatar-btn').addEventListener('click', () => navigateToPage('profile'));
  document.getElementById('view-all-btn').addEventListener('click', () => navigateToPage('transactions'));
  navigateToPage('dashboard');

  // Keep the display preference separate from financial and account data.
  const themePreferenceInputs = document.querySelectorAll('input[name="spendly-theme"]');
  if (window.SpendlyTheme) {
    const savedTheme = window.SpendlyTheme.get();
    themePreferenceInputs.forEach(input => {
      input.checked = input.value === savedTheme;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const appliedTheme = window.SpendlyTheme.set(input.value);
        themePreferenceInputs.forEach(option => { option.checked = option.value === appliedTheme; });
      });
    });
  }

  // Make the existing clickable cards and settings rows usable from a keyboard too.
  document.querySelectorAll('.settings-row, .section-action, .quick-action, .dashboard-shortcut, .header-notif, .header-avatar, .empty-cta').forEach(control => {
    control.setAttribute('role', 'button');
    if (!control.hasAttribute('tabindex')) control.tabIndex = 0;
    control.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        control.click();
      }
    });
  });
  document.querySelectorAll('.quick-amt').forEach(control => {
    control.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        control.click();
      }
    });
  });

  /* ══════════════════════════════════════════
     RIPPLE EFFECT
  ══════════════════════════════════════════ */
  function addRipple(el, e) {
    const rect   = el.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height);
    const x      = (e.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
    const y      = (e.clientY || rect.top + rect.height / 2) - rect.top - size / 2;
    const ripple = document.createElement('span');
    ripple.classList.add('ripple');
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
    el.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  /* ══════════════════════════════════════════
     PHASE 5A — KHATA (WHO OWES ME & REPAYMENT)
  ══════════════════════════════════════════ */

  // Show/hide friend name field when Khata toggle flips
  expKhataChk.addEventListener('change', () => {
    khataFriendField.classList.toggle('visible', expKhataChk.checked);
    if (expKhataChk.checked) {
      expSplitChk.checked = false;
      splitInfoPanel.classList.remove('visible');
    }
    validateExpForm();
  });

  // Render the "Who Owes Me" section with Repay workflow
  function renderKhata() {
    let items = [];

    if (isAuthenticated()) {
      // Backend khata records with outstanding > 0
      items = _khata
        .map(k => {
          const outstandingCents = k.outstanding !== undefined
            ? amountToCents(k.outstanding)
            : amountToCents(k.original_amount) - amountToCents(k.amount_repaid);
          return { ...k, outstandingCents };
        })
        .filter(k => k.outstandingCents > 0)
        .map(k => ({
          id: k.id,
          name: k.friend_name,
          outstanding: centsToAmount(k.outstandingCents),
          date: k.lent_date,
          walletId: k.wallet_id,
          walletType: k.wallet_type || 'cash'
        }));
    } else {
      const db = getDB();
      const records = db.lentRecords || [];
      const grouped = {};
      records.forEach(r => {
        if (!r || typeof r.friendName !== 'string' || !r.friendName.trim()) return;
        const key = r.friendName.trim().toLowerCase();
        if (!grouped[key]) grouped[key] = { id: r.id, name: r.friendName, outstandingCents: 0, count: 0, date: r.date, walletType: r.wallet || 'cash' };
        grouped[key].outstandingCents += amountToCents(r.amount);
        grouped[key].count++;
        if (new Date(r.date) > new Date(grouped[key].date)) grouped[key].date = r.date;
      });
      items = Object.values(grouped).filter(g => g.outstandingCents > 0).map(g => ({ ...g, outstanding: centsToAmount(g.outstandingCents) }));
    }

    if (items.length === 0) {
      khataSection.style.display = 'none';
      return;
    }
    khataSection.style.display = 'block';

    khataList.innerHTML = items.map((g, i) => `
      <div class="khata-card" style="margin-bottom:8px;animation-delay:${i*0.05}s">
        <div class="khata-avatar">${escapeHtml(g.name.charAt(0).toUpperCase())}</div>
        <div style="flex:1;min-width:0">
          <div class="khata-friend-name">${escapeHtml(g.name)}</div>
          <div class="khata-friend-meta">Lent on ${formatDate(g.date)}</div>
        </div>
        <div class="khata-friend-amt">₹${fmt(g.outstanding)}</div>
        <button class="khata-settle-btn" data-id="${escapeHtml(g.id || '')}" data-name="${encodeURIComponent(g.name)}" data-outstanding="${g.outstanding}">
          Repay
        </button>
      </div>
    `).join('');

    khataList.querySelectorAll('.khata-settle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openRepayModal({
          id: btn.dataset.id,
          name: decodeURIComponent(btn.dataset.name),
          outstanding: Number(btn.dataset.outstanding)
        });
      });
    });
  }

  // Khata Repayment modal
  const repayModal          = document.getElementById('repay-modal');
  const repayFriendNameEl   = document.getElementById('repay-friend-name');
  const repayOutstandingEl  = document.getElementById('repay-outstanding-amt');
  const repayAmountInput    = document.getElementById('repay-amount-input');
  const repayWalletCash     = document.getElementById('repay-wallet-cash');
  const repayWalletOnline   = document.getElementById('repay-wallet-online');
  const repayConfirmBtn     = document.getElementById('repay-confirm-btn');

  let activeRepayRecord = null;
  let repayDestWallet = 'cash';

  function openRepayModal(rec) {
    activeRepayRecord = rec;
    repayFriendNameEl.textContent = rec.name;
    repayOutstandingEl.textContent = `₹${fmt(rec.outstanding)}`;
    repayAmountInput.value = rec.outstanding;
    repayDestWallet = 'cash';
    repayWalletCash.className = 'wallet-toggle-btn active-cash';
    repayWalletOnline.className = 'wallet-toggle-btn';
    repayConfirmBtn.disabled = false;
    repayModal.classList.add('open');
    setTimeout(() => repayAmountInput.focus(), 300);
  }

  function closeRepayModal() {
    repayModal.classList.remove('open');
    activeRepayRecord = null;
    repayAmountInput.value = '';
  }

  repayModal.addEventListener('click', (e) => {
    if (e.target === repayModal) closeRepayModal();
  });

  repayWalletCash.addEventListener('click', () => {
    repayDestWallet = 'cash';
    repayWalletCash.className = 'wallet-toggle-btn active-cash';
    repayWalletOnline.className = 'wallet-toggle-btn';
  });

  repayWalletOnline.addEventListener('click', () => {
    repayDestWallet = 'online';
    repayWalletCash.className = 'wallet-toggle-btn';
    repayWalletOnline.className = 'wallet-toggle-btn active-online';
  });

  repayAmountInput.addEventListener('input', () => {
    const amountCents = inputAmountToCents(repayAmountInput.value);
    const valid = amountCents > 0 && activeRepayRecord && amountCents <= amountToCents(activeRepayRecord.outstanding);
    repayConfirmBtn.disabled = !valid;
  });

  repayConfirmBtn.addEventListener('click', async () => {
    const repayCents = inputAmountToCents(repayAmountInput.value);
    const repayAmt = repayCents === null ? 0 : centsToAmount(repayCents);
    if (!(repayCents > 0) || !activeRepayRecord) return;
    if (repayConfirmBtn.disabled) return;
    const friendName = activeRepayRecord.name;

    repayConfirmBtn.disabled = true;
    const origText = repayConfirmBtn.textContent;
    repayConfirmBtn.textContent = 'Processing…';

    if (isAuthenticated()) {
      try {
        const res = await authFetch(`${API_BASE}/khata/${activeRepayRecord.id}/repay`, {
          method: 'POST',
          body: JSON.stringify({ amount: repayAmt, wallet_id: getWalletByType(repayDestWallet)?.id, note: 'Repaid by friend' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to record repayment');

        await loadServerData();
        refreshBalanceDisplay();
        renderKhata();
        renderTransactions();
        closeRepayModal();
        showToast(`✓ ₹${fmt(repayAmt)} repayment recorded from ${friendName}`);
      } catch (err) {
        showToast(`✗ ${err.message}`, 'error');
      } finally {
        repayConfirmBtn.disabled = false;
        repayConfirmBtn.textContent = origText;
      }
    } else {
      // Offline repayment: add back to wallet and reduce friend debt
      const db = getDB();
      const balKey = repayDestWallet === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance';
      db[balKey] = centsToAmount(amountToCents(db[balKey] || 0) + repayCents);

      if (db.lentRecords) {
        let remainingToDeduct = repayCents;
        for (let i = 0; i < db.lentRecords.length; i++) {
          const r = db.lentRecords[i];
          if (r.friendName.trim().toLowerCase() === friendName.trim().toLowerCase()) {
            const recordCents = amountToCents(r.amount);
            if (recordCents <= remainingToDeduct) {
              remainingToDeduct -= recordCents;
              db.lentRecords.splice(i, 1);
              i--;
            } else {
              r.amount = centsToAmount(recordCents - remainingToDeduct);
              remainingToDeduct = 0;
              break;
            }
            if (remainingToDeduct <= 0) break;
          }
        }
      }
      saveDB(db);
      refreshBalanceDisplay();
      renderKhata();
      closeRepayModal();
      showToast(`✓ ₹${fmt(repayAmt)} repaid from ${friendName}`);
      repayConfirmBtn.disabled = false;
      repayConfirmBtn.textContent = origText;
    }
  });

  // Clear all khata records handler
  async function clearAllKhata() {
    if (!confirm('Remove all "Who Owes Me" records?')) return;
    if (isAuthenticated()) {
      try {
        const res = await authFetch(`${API_BASE}/khata/clear`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to clear Khata records on server');
        await loadServerData();
        renderKhata();
        showToast('✓ Khata book cleared');
      } catch (err) {
        showToast(`✗ ${err.message}`, 'error');
      }
    } else {
      const db = getDB();
      for (const record of db.lentRecords || []) {
        const key = record.wallet === 'online' ? 'currentOnlineBalance' : 'currentCashBalance';
        db[key] = centsToAmount(amountToCents(db[key] || 0) + amountToCents(record.amount));
      }
      db.lentRecords = [];
      saveDB(db);
      refreshBalanceDisplay();
      renderKhata();
      showToast('✓ Khata book cleared');
    }
  }

  khataClearBtn.addEventListener('click', clearAllKhata);
  document.getElementById('btn-clear-khata-settings').addEventListener('click', clearAllKhata);

  // Deferred expense settlement
  const deferredPayModal = document.getElementById('deferred-pay-modal');
  const deferredPayCategory = document.getElementById('deferred-pay-category');
  const deferredPayOriginal = document.getElementById('deferred-pay-original');
  const deferredPayOutstanding = document.getElementById('deferred-pay-outstanding');
  const deferredPayHint = document.getElementById('deferred-pay-hint');
  const deferredWalletCash = document.getElementById('deferred-wallet-cash');
  const deferredWalletOnline = document.getElementById('deferred-wallet-online');
  const deferredPayConfirm = document.getElementById('deferred-pay-confirm');
  let activeDeferredLiabilityId = null;
  let deferredPaymentWallet = 'cash';
  let deferredPaymentBusy = false;

  function findDeferredLiability(db, id) {
    return (db.pendingLiabilities || []).find(item => String(item.id) === String(id)) || null;
  }

  function deferredWalletBalanceCents(walletType) {
    if (isAuthenticated()) return amountToCents(getWalletByType(walletType)?.balance || 0);
    const db = getOfflineDB();
    return amountToCents(db[walletType === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance'] || 0);
  }

  function updateDeferredPayWalletButtons() {
    const liability = activeDeferredLiabilityId ? findDeferredLiability(getOfflineDB(), activeDeferredLiabilityId) : null;
    const selectedWallet = liability?.settlementWallet || deferredPaymentWallet;
    deferredPaymentWallet = selectedWallet;
    deferredWalletCash.className = `wallet-toggle-btn${selectedWallet === 'cash' ? ' active-cash' : ''}`;
    deferredWalletOnline.className = `wallet-toggle-btn${selectedWallet === 'online' ? ' active-online' : ''}`;
    deferredWalletCash.setAttribute('aria-pressed', String(selectedWallet === 'cash'));
    deferredWalletOnline.setAttribute('aria-pressed', String(selectedWallet === 'online'));
    const hasRetryIntent = !!liability?.settlementWallet;
    deferredWalletCash.disabled = deferredPaymentBusy || hasRetryIntent;
    deferredWalletOnline.disabled = deferredPaymentBusy || hasRetryIntent;
    deferredWalletCash.textContent = `Cash Wallet \u00B7 \u20B9${fmt(centsToAmount(deferredWalletBalanceCents('cash')))}`;
    deferredWalletOnline.textContent = `Online Wallet \u00B7 \u20B9${fmt(centsToAmount(deferredWalletBalanceCents('online')))}`;
  }

  function openDeferredPayModal(id) {
    const liability = findDeferredLiability(getOfflineDB(), id);
    if (!liability || liabilityOutstandingCents(liability) <= 0) {
      showToast('This deferred expense is already settled or unavailable.', 'info');
      return;
    }
    activeDeferredLiabilityId = String(liability.id);
    deferredPaymentWallet = liability.settlementWallet || liability.fromWallet || liability.wallet || 'cash';
    deferredPayCategory.textContent = liability.category || 'Deferred expense';
    deferredPayOriginal.textContent = `\u20B9${fmt(liability.amount)}`;
    deferredPayOutstanding.textContent = `\u20B9${fmt(centsToAmount(liabilityOutstandingCents(liability)))}`;
    deferredPayHint.textContent = liability.settlementWallet
      ? 'A previous attempt may have reached the server. Retry uses the same wallet and payment reference.'
      : 'The wallet balance will be reduced by the outstanding amount only.';
    deferredPayConfirm.textContent = `Pay \u20B9${fmt(centsToAmount(liabilityOutstandingCents(liability)))}`;
    deferredPayConfirm.disabled = false;
    updateDeferredPayWalletButtons();
    deferredPayModal.classList.add('open');
    setTimeout(() => deferredPayConfirm.focus(), 250);
  }

  function closeDeferredPayModal() {
    if (deferredPaymentBusy) return;
    deferredPayModal.classList.remove('open');
    activeDeferredLiabilityId = null;
  }

  deferredPayModal.addEventListener('click', event => {
    if (event.target === deferredPayModal) closeDeferredPayModal();
  });
  deferredWalletCash.addEventListener('click', () => {
    const liability = activeDeferredLiabilityId ? findDeferredLiability(getOfflineDB(), activeDeferredLiabilityId) : null;
    if (deferredPaymentBusy || liability?.settlementWallet) return;
    deferredPaymentWallet = 'cash';
    updateDeferredPayWalletButtons();
  });
  deferredWalletOnline.addEventListener('click', () => {
    const liability = activeDeferredLiabilityId ? findDeferredLiability(getOfflineDB(), activeDeferredLiabilityId) : null;
    if (deferredPaymentBusy || liability?.settlementWallet) return;
    deferredPaymentWallet = 'online';
    updateDeferredPayWalletButtons();
  });

  deferredPayConfirm.addEventListener('click', async () => {
    if (deferredPaymentBusy || !activeDeferredLiabilityId) return;
    deferredPaymentBusy = true;
    deferredPayConfirm.disabled = true;
    deferredPayConfirm.textContent = 'Processing...';
    updateDeferredPayWalletButtons();
    const liabilityId = activeDeferredLiabilityId;
    try {
      if (isAuthenticated()) {
        const local = getOfflineDB();
        const liability = findDeferredLiability(local, liabilityId);
        if (!liability) throw new Error('Deferred expense was not found.');
        const dueCents = liabilityOutstandingCents(liability);
        if (dueCents <= 0) throw new Error('This deferred expense is already settled.');
        const walletType = liability.settlementWallet || deferredPaymentWallet;
        const wallet = getWalletByType(walletType);
        if (!wallet) throw new Error('Selected wallet is unavailable for this account.');
        const idempotencyKey = `deferred-settlement:${liability.id}`;
        liability.settlementWallet = walletType;
        saveOfflineDB(local);

        const response = await authFetch(`${API_BASE}/transactions`, {
          method: 'POST',
          body: JSON.stringify({
            wallet_id: wallet.id,
            type: 'expense',
            amount: centsToAmount(dueCents),
            category: liability.category,
            category_emoji: CATEGORY_EMOJI[liability.category] || '\u{1F4B3}',
            note: `Spendly deferred settlement: ${liability.id}`,
            idempotency_key: idempotencyKey
          })
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status < 500 && response.status !== 409) {
            const retryLocal = getOfflineDB();
            const retryLiability = findDeferredLiability(retryLocal, liabilityId);
            if (retryLiability) {
              delete retryLiability.settlementWallet;
              saveOfflineDB(retryLocal);
            }
          }
          throw new Error(data.error || 'Failed to pay the deferred expense.');
        }

        const updated = getOfflineDB();
        const updatedLiability = findDeferredLiability(updated, liabilityId);
        if (updatedLiability) {
          updatedLiability.remainingAmount = 0;
          updatedLiability.status = 'settled';
          updatedLiability.settledAt = data.transaction.transaction_date || new Date().toISOString();
          updatedLiability.settlementWallet = walletType;
          updatedLiability.settlementTransactionId = data.transaction.id;
          saveOfflineDB(updated);
        }
        if (data.wallet) {
          const walletIndex = _wallets.findIndex(item => item.id === data.wallet.id);
          if (walletIndex === -1) _wallets.push(data.wallet);
          else _wallets[walletIndex] = data.wallet;
        }
        if (!_transactions.some(item => String(item.id) === String(data.transaction.id))) _transactions.unshift(data.transaction);
        await loadServerData();
      } else {
        const db = getDB();
        const liability = findDeferredLiability(db, liabilityId);
        if (!liability) throw new Error('Deferred expense was not found.');
        const dueCents = liabilityOutstandingCents(liability);
        if (dueCents <= 0) throw new Error('This deferred expense is already settled.');
        const walletType = deferredPaymentWallet;
        const balanceKey = walletType === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance';
        const balanceCents = amountToCents(db[balanceKey] || 0);
        if (balanceCents < dueCents) throw new Error(`Insufficient ${walletType === 'cash' ? 'Cash' : 'Online'} balance.`);
        const usedIds = new Set((db.transactions || []).map(item => String(item.id)));
        let transactionId = Date.now();
        while (usedIds.has(String(transactionId))) transactionId += 1;
        const settledAt = new Date().toISOString();
        db[balanceKey] = centsToAmount(balanceCents - dueCents);
        if (!db.transactions) db.transactions = [];
        db.transactions.unshift({
          id: transactionId,
          date: settledAt,
          type: 'expense',
          amount: centsToAmount(dueCents),
          category: liability.category,
          category_emoji: CATEGORY_EMOJI[liability.category] || '\u{1F4B3}',
          notes: `Spendly deferred settlement: ${liability.id}`,
          wallet: walletType
        });
        liability.remainingAmount = 0;
        liability.status = 'settled';
        liability.settledAt = settledAt;
        liability.settlementWallet = walletType;
        liability.settlementTransactionId = transactionId;
        saveDB(db);
      }

      deferredPaymentBusy = false;
      deferredPayModal.classList.remove('open');
      activeDeferredLiabilityId = null;
      refreshBalanceDisplay();
      renderTransactions();
      buildCalendar();
      renderCalTxns();
      showToast('Deferred expense paid and marked as settled.', 'success');
    } catch (error) {
      showToast(`Unable to settle deferred expense: ${error.message}`, 'error');
    } finally {
      deferredPaymentBusy = false;
      if (deferredPayModal.classList.contains('open')) {
        deferredPayConfirm.disabled = false;
        const current = findDeferredLiability(getOfflineDB(), liabilityId);
        deferredPayConfirm.textContent = current && liabilityOutstandingCents(current) > 0
          ? `Pay \u20B9${fmt(centsToAmount(liabilityOutstandingCents(current)))}`
          : 'Already settled';
        updateDeferredPayWalletButtons();
      }
    }
  });

  /* ══════════════════════════════════════════
     PHASE 5B — DATA SAFETY (EXPORT / IMPORT)
  ══════════════════════════════════════════ */

  // ── EXPORT ──
  document.getElementById('btn-export').addEventListener('click', () => {
    let exportData;
    if (isAuthenticated()) {
      const { cash, online } = getTotalBalances();
      exportData = {
        currentCashBalance: cash,
        currentOnlineBalance: online,
        transactions: _transactions.map(t => ({
          id: t.id,
          amount: t.amount,
          category: t.category,
          category_emoji: t.category_emoji,
          date: t.transaction_date,
          notes: t.note,
          wallet: t.wallet_type || 'cash',
          type: t.type || 'expense',
          transfer_id: t.transfer_id || null
        })),
        pendingLiabilities: getOfflineDB().pendingLiabilities || [],
        lentRecords: _khata.map(k => ({
          id: k.id,
          friendName: k.friend_name,
          amount: k.outstanding || (k.original_amount - k.amount_repaid),
          date: k.lent_date,
          category: k.category,
          notes: k.note,
          wallet: k.wallet_type || 'cash'
        }))
      };
    } else {
      exportData = getOfflineDB();
    }
    const json  = JSON.stringify(exportData, null, 2);
    const blob  = new Blob([json], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = 'spendly_backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ Backup downloaded as spendly_backup.json', 'success');
  });

  // ── IMPORT — with strict schema validation ──
  function validateImportedDate(value, label) {
    if (typeof value !== 'string') throw new Error(`${label} must be a date string.`);
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const year = Number(dateOnly[1]), month = Number(dateOnly[2]), day = Number(dateOnly[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error(`${label} is not a valid date.`);
      return value;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new Error(`${label} must be a valid ISO date.`);
    }
    return value;
  }

  function validateImportedAmount(value, label, { allowZero = false } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value))) {
      throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} amount with up to two decimal places.`);
    }
    const cents = amountToCents(value);
    if (!Number.isSafeInteger(cents)) throw new Error(`${label} is too large.`);
    return cents;
  }

  function validateBackup(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('The backup must contain a JSON object.');
    const rootKeys = new Set(['currentCashBalance', 'currentOnlineBalance', 'transactions', 'pendingLiabilities', 'lentRecords']);
    if (Object.keys(source).some(key => !rootKeys.has(key))) throw new Error('The backup contains unsupported data fields.');
    const cashCents = validateImportedAmount(source.currentCashBalance, 'Cash balance', { allowZero: true });
    const onlineCents = validateImportedAmount(source.currentOnlineBalance, 'Online balance', { allowZero: true });
    if (!Array.isArray(source.transactions)) throw new Error('Transactions must be an array.');
    const pending = source.pendingLiabilities === undefined ? [] : source.pendingLiabilities;
    const lent = source.lentRecords === undefined ? [] : source.lentRecords;
    if (!Array.isArray(pending) || !Array.isArray(lent)) throw new Error('Deferred payments and lent records must be arrays.');
    if (source.transactions.length > 5000 || pending.length > 1000 || lent.length > 1000) throw new Error('The backup contains too many records.');

    const txKeys = new Set(['id', 'wallet_id', 'wallet', 'type', 'amount', 'category', 'category_emoji', 'date', 'transaction_date', 'notes', 'note', 'transfer_id']);
    const txIds = new Set();
    const transactions = source.transactions.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Transaction ${index + 1} must be an object.`);
      if (Object.keys(item).some(key => !txKeys.has(key))) throw new Error(`Transaction ${index + 1} has unsupported fields.`);
      if (item.id !== undefined) {
        if (!Number.isSafeInteger(item.id) || item.id <= 0 || txIds.has(item.id)) throw new Error(`Transaction ${index + 1} has a missing, invalid, or duplicate ID.`);
        txIds.add(item.id);
      }
      const amountCents = validateImportedAmount(item.amount, `Transaction ${index + 1} amount`);
      if (typeof item.category !== 'string' || !item.category.trim() || item.category.trim().length > 80) throw new Error(`Transaction ${index + 1} needs a valid category.`);
      if (item.type !== undefined && item.type !== 'expense' && item.type !== 'income') throw new Error(`Transaction ${index + 1} has an unsupported type.`);
      if (item.wallet !== 'cash' && item.wallet !== 'online') throw new Error(`Transaction ${index + 1} needs a valid Cash or Online wallet.`);
      if (item.wallet_id !== undefined && (!Number.isSafeInteger(item.wallet_id) || item.wallet_id <= 0)) throw new Error(`Transaction ${index + 1} has an invalid wallet reference.`);
      const date = validateImportedDate(item.transaction_date === undefined ? item.date : item.transaction_date, `Transaction ${index + 1} date`);
      const note = item.note === undefined ? item.notes : item.note;
      if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) throw new Error(`Transaction ${index + 1} note must be text up to 500 characters.`);
      if (item.category_emoji !== undefined && item.category_emoji !== null && (typeof item.category_emoji !== 'string' || item.category_emoji.length > 16)) throw new Error(`Transaction ${index + 1} icon is invalid.`);
      if (item.transfer_id !== undefined && item.transfer_id !== null && (typeof item.transfer_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.transfer_id))) throw new Error(`Transaction ${index + 1} has an invalid transfer reference.`);
      if (!isAuthenticated() && item.wallet_id !== undefined) throw new Error(`Transaction ${index + 1} wallet ID cannot be verified in offline mode.`);
      return { ...item, amount: centsToAmount(amountCents), type: item.type || 'expense', category: item.category.trim(), date, notes: (note || '').trim(), category_emoji: item.category_emoji || '💳', transfer_id: item.transfer_id || null };
    });

    const memoOf = note => {
      const separator = (note || '').indexOf(':');
      return separator < 0 ? null : note.slice(separator + 1).trim();
    };
    for (let index = 0; index < transactions.length; index += 1) {
      const item = transactions[index];
      if (item.category !== 'Transfer Out' && item.category !== 'Transfer In') continue;
      if (item.transfer_id) continue;
      const wantCategory = item.category === 'Transfer Out' ? 'Transfer In' : 'Transfer Out';
      const wantType = item.category === 'Transfer Out' ? 'income' : 'expense';
      const candidates = transactions.map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate, candidateIndex }) => candidateIndex !== index && !candidate.transfer_id &&
          candidate.category === wantCategory && candidate.type === wantType && candidate.wallet !== item.wallet &&
          amountToCents(candidate.amount) === amountToCents(item.amount) && candidate.date === item.date &&
          memoOf(candidate.notes) !== null && memoOf(candidate.notes) === memoOf(item.notes));
      if (candidates.length !== 1) throw new Error(`Transfer transaction ${index + 1} is missing its matching wallet entry.`);
      const transferId = `backup-${Math.min(index, candidates[0].candidateIndex)}-${Math.max(index, candidates[0].candidateIndex)}`;
      item.transfer_id = transferId;
      candidates[0].candidate.transfer_id = transferId;
    }
    const transferGroups = new Map();
    transactions.forEach(item => {
      const isTransfer = item.category === 'Transfer Out' || item.category === 'Transfer In';
      if (isTransfer && !item.transfer_id) throw new Error('Backup transfer records must include both sides.');
      if (item.transfer_id) {
        if (!isTransfer) throw new Error('Only Transfer Out and Transfer In entries can have transfer references.');
        if (!transferGroups.has(item.transfer_id)) transferGroups.set(item.transfer_id, []);
        transferGroups.get(item.transfer_id).push(item);
      }
    });
    for (const pair of transferGroups.values()) {
      const outgoing = pair.find(item => item.category === 'Transfer Out' && item.type === 'expense');
      const incoming = pair.find(item => item.category === 'Transfer In' && item.type === 'income');
      if (pair.length !== 2 || !outgoing || !incoming || outgoing.wallet === incoming.wallet || amountToCents(outgoing.amount) !== amountToCents(incoming.amount) || outgoing.date !== incoming.date) {
        throw new Error('Backup transfer entries need matching outgoing and incoming sides.');
      }
    }

    const pendingKeys = new Set(['id', 'dueDate', 'amount', 'remainingAmount', 'status', 'settledAt', 'settlementWallet', 'settlementTransactionId', 'category', 'notes', 'fromWallet', 'wallet']);
    const pendingIds = new Set();
    const checkedPending = pending.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !pendingKeys.has(key))) throw new Error(`Deferred payment ${index + 1} has an invalid shape.`);
      if (item.id !== undefined) {
        if (!Number.isSafeInteger(item.id) || item.id <= 0 || pendingIds.has(item.id)) throw new Error(`Deferred payment ${index + 1} has an invalid or duplicate ID.`);
        pendingIds.add(item.id);
      }
      const amountCents = validateImportedAmount(item.amount, `Deferred payment ${index + 1} amount`);
      const status = item.status === undefined ? 'outstanding' : item.status;
      if (status !== 'outstanding' && status !== 'settled') throw new Error(`Deferred payment ${index + 1} has an invalid status.`);
      const remainingCents = item.remainingAmount === undefined
        ? (status === 'settled' ? 0 : amountCents)
        : validateImportedAmount(item.remainingAmount, `Deferred payment ${index + 1} remaining amount`, { allowZero: true });
      if (remainingCents > amountCents || (status === 'settled' && remainingCents !== 0) || (status === 'outstanding' && remainingCents === 0)) {
        throw new Error(`Deferred payment ${index + 1} has inconsistent settlement amounts.`);
      }
      const date = validateImportedDate(item.dueDate, `Deferred payment ${index + 1} due date`);
      if (typeof item.category !== 'string' || !item.category.trim() || item.category.length > 80) throw new Error(`Deferred payment ${index + 1} needs a valid category.`);
      const wallet = item.fromWallet === undefined ? item.wallet : item.fromWallet;
      if (wallet !== undefined && wallet !== 'cash' && wallet !== 'online') throw new Error(`Deferred payment ${index + 1} has an invalid wallet reference.`);
      if (item.settlementWallet !== undefined && item.settlementWallet !== 'cash' && item.settlementWallet !== 'online') throw new Error(`Deferred payment ${index + 1} has an invalid settlement wallet.`);
      if (item.notes !== undefined && typeof item.notes !== 'string') throw new Error(`Deferred payment ${index + 1} notes must be text.`);
      const settledAt = item.settledAt === undefined ? undefined : validateImportedDate(item.settledAt, `Deferred payment ${index + 1} settlement date`);
      if (item.settlementTransactionId !== undefined && (!Number.isSafeInteger(item.settlementTransactionId) || item.settlementTransactionId <= 0)) throw new Error(`Deferred payment ${index + 1} has an invalid settlement transaction reference.`);
      return { ...item, amount: centsToAmount(amountCents), remainingAmount: centsToAmount(remainingCents), status, settledAt, dueDate: date, category: item.category.trim(), fromWallet: wallet || 'cash' };
    });

    const lentKeys = new Set(['id', 'wallet_id', 'wallet', 'friendName', 'friend_name', 'amount', 'date', 'lent_date', 'category', 'notes', 'note', 'category_emoji']);
    const lentIds = new Set();
    const checkedLent = lent.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !lentKeys.has(key))) throw new Error(`Lent record ${index + 1} has an invalid shape.`);
      if (item.id !== undefined) {
        if (!Number.isSafeInteger(item.id) || item.id <= 0 || lentIds.has(item.id)) throw new Error(`Lent record ${index + 1} has a missing, invalid, or duplicate ID.`);
        lentIds.add(item.id);
      }
      const amountCents = validateImportedAmount(item.amount, `Lent record ${index + 1} amount`);
      const friendName = item.friendName === undefined ? item.friend_name : item.friendName;
      if (typeof friendName !== 'string' || !friendName.trim() || friendName.length > 80) throw new Error(`Lent record ${index + 1} needs a valid friend name.`);
      if (typeof item.category !== 'string' || !item.category.trim() || item.category.length > 80) throw new Error(`Lent record ${index + 1} needs a valid category.`);
      if (item.wallet !== 'cash' && item.wallet !== 'online') throw new Error(`Lent record ${index + 1} needs a valid wallet reference.`);
      if (item.wallet_id !== undefined && (!Number.isSafeInteger(item.wallet_id) || item.wallet_id <= 0)) throw new Error(`Lent record ${index + 1} has an invalid wallet reference.`);
      if (!isAuthenticated() && item.wallet_id !== undefined) throw new Error(`Lent record ${index + 1} wallet ID cannot be verified in offline mode.`);
      const date = validateImportedDate(item.lent_date === undefined ? item.date : item.lent_date, `Lent record ${index + 1} date`);
      const note = item.note === undefined ? item.notes : item.note;
      if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) throw new Error(`Lent record ${index + 1} note must be text.`);
      return { ...item, amount: centsToAmount(amountCents), friendName: friendName.trim(), date, notes: (note || '').trim(), category: item.category.trim() };
    });
    return { currentCashBalance: centsToAmount(cashCents), currentOnlineBalance: centsToAmount(onlineCents), transactions, pendingLiabilities: checkedPending, lentRecords: checkedLent };
  }

  function importKey(item) {
    return JSON.stringify([item.wallet || item.fromWallet || 'cash', item.type || 'expense', amountToCents(item.amount), item.category, item.notes || '', item.date || item.dueDate]);
  }

  function uniqueImportedRecords(existing, incoming, keyOf) {
    const seen = new Set(existing.map(keyOf));
    return incoming.filter(item => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  document.getElementById('btn-import').addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      showToast('Backup is too large. Choose a file smaller than 1 MB.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const parsed = validateBackup(JSON.parse(e.target.result));
        if (isAuthenticated()) {
          if (!_currentUser) throw new Error('Your account has not finished loading. Retry after reconnecting.');
          const res = await authFetch(`${API_BASE}/import`, { method: 'POST', body: JSON.stringify(parsed) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'The backup could not be imported.');
          const local = getOfflineDB();
          const currentPending = local.pendingLiabilities || [];
          local.pendingLiabilities = [...currentPending, ...uniqueImportedRecords(currentPending, parsed.pendingLiabilities, importKey)];
          saveOfflineDB(local);
          await loadServerData();
          showToast(`Backup merged: ${data.importedTransactions} transactions and ${data.importedLentRecords} lent records added; matching records skipped.`, 'success');
        } else {
          const local = getOfflineDB();
          const hadData = (local.transactions || []).length + (local.pendingLiabilities || []).length + (local.lentRecords || []).length > 0 || amountToCents(local.currentCashBalance) > 0 || amountToCents(local.currentOnlineBalance) > 0;
          const transactionsToAdd = uniqueImportedRecords(local.transactions || [], parsed.transactions, importKey);
          const lentKey = item => JSON.stringify([item.wallet || 'cash', amountToCents(item.amount), item.category || '', item.notes || '', item.friendName || '', item.date || '']);
          const lentToAdd = uniqueImportedRecords(local.lentRecords || [], parsed.lentRecords, lentKey);
          let cashCents = hadData ? amountToCents(local.currentCashBalance) : amountToCents(parsed.currentCashBalance);
          let onlineCents = hadData ? amountToCents(local.currentOnlineBalance) : amountToCents(parsed.currentOnlineBalance);
          if (hadData) {
            for (const item of transactionsToAdd) {
              const delta = item.type === 'income' ? amountToCents(item.amount) : -amountToCents(item.amount);
              if (item.wallet === 'cash') cashCents += delta; else onlineCents += delta;
            }
            for (const item of lentToAdd) {
              if (item.wallet === 'cash') cashCents -= amountToCents(item.amount); else onlineCents -= amountToCents(item.amount);
            }
          }
          if (cashCents < 0 || onlineCents < 0) throw new Error('These additional records would make a wallet balance negative.');
          const pendingToAdd = uniqueImportedRecords(local.pendingLiabilities || [], parsed.pendingLiabilities, importKey);
          local.currentCashBalance = centsToAmount(cashCents);
          local.currentOnlineBalance = centsToAmount(onlineCents);
          local.transactions = [...(local.transactions || []), ...transactionsToAdd];
          local.lentRecords = [...(local.lentRecords || []), ...lentToAdd];
          local.pendingLiabilities = [...(local.pendingLiabilities || []), ...pendingToAdd];
          saveOfflineDB(local);
          showToast(`Backup merged: ${transactionsToAdd.length} transactions added; matching records skipped.`, 'success');
        }
        refreshBalanceDisplay();
        renderTransactions();
        renderKhata();
        buildCalendar();
        renderCalTxns();
      } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error');
      }
    };
    reader.onerror = () => showToast('Could not read the selected backup file.', 'error');
    reader.readAsText(file);
  });

  // ── Reset All Data ──
  document.getElementById('btn-reset-all').addEventListener('click', async () => {
    if (!confirm('⚠ This will DELETE all your data. Are you sure?')) return;
    if (isAuthenticated()) {
      try {
        const res = await authFetch(`${API_BASE}/reset`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to reset data on server');
        await loadServerData();
        refreshBalanceDisplay();
        renderTransactions();
        renderKhata();
        buildCalendar();
        renderCalTxns();
        showToast('✓ All user data reset', 'info');
      } catch (err) {
        showToast(`✗ ${err.message}`, 'error');
      }
    } else {
      localStorage.removeItem(offlineStorageKey());
      refreshBalanceDisplay();
      renderTransactions();
      renderKhata();
      buildCalendar();
      renderCalTxns();
      showToast('✓ All data reset', 'info');
    }
  });

  // ── Logout with Full Storage Isolation (BUG-02) ──
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (!confirm('Sign out of your Spendly account?')) return;
      const token = getAuthToken();
      let serverRevocationConfirmed = false;
      if (token) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(`${API_BASE}/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal
          });
          serverRevocationConfirmed = response.ok;
        } catch {
          serverRevocationConfirmed = false;
        } finally {
          clearTimeout(timeoutId);
        }
      }
      sessionStorage.removeItem('spendly_auth_token');
      localStorage.removeItem('spendly_auth_token');
      localStorage.removeItem('spendly_user');
      clearUserCache();
      if (!serverRevocationConfirmed) {
        window.alert('You were signed out on this device, but server-side session revocation could not be confirmed. The session may remain valid until it expires.');
      }
      window.location.href = 'login.html';
    });
  }

  /* ══════════════════════════════════════════
     INERT CONTROLS WIRING (BUG-06)
  ══════════════════════════════════════════ */

  // 1. TRANSFER MODAL (#qa-transfer)
  const transferModal   = document.getElementById('transfer-modal');
  const transferDirC2O  = document.getElementById('transfer-dir-c2o');
  const transferDirO2C  = document.getElementById('transfer-dir-o2c');
  const transferAmtIn   = document.getElementById('transfer-amount-input');
  const transferWarn    = document.getElementById('transfer-balance-warning');
  const transferConfirm = document.getElementById('transfer-confirm-btn');
  let transferDirection = 'c2o'; // 'c2o' = Cash -> Online, 'o2c' = Online -> Cash

  function openTransferModal() {
    transferDirection = 'c2o';
    transferDirC2O.classList.add('active');
    transferDirO2C.classList.remove('active');
    transferAmtIn.value = '';
    transferWarn.style.display = 'none';
    transferConfirm.disabled = true;
    transferModal.classList.add('open');
    setTimeout(() => transferAmtIn.focus(), 300);
  }

  function closeTransferModal() {
    transferModal.classList.remove('open');
  }

  document.getElementById('qa-transfer').addEventListener('click', openTransferModal);
  transferModal.addEventListener('click', (e) => {
    if (e.target === transferModal) closeTransferModal();
  });

  transferDirC2O.addEventListener('click', () => {
    transferDirection = 'c2o';
    transferDirC2O.classList.add('active');
    transferDirO2C.classList.remove('active');
    validateTransferForm();
  });

  transferDirO2C.addEventListener('click', () => {
    transferDirection = 'o2c';
    transferDirO2C.classList.add('active');
    transferDirC2O.classList.remove('active');
    validateTransferForm();
  });

  function validateTransferForm() {
    const amountCents = inputAmountToCents(transferAmtIn.value);
    const { cash, online } = getTotalBalances();
    const sourceCents = amountToCents(transferDirection === 'c2o' ? cash : online);
    const insufficient = amountCents > 0 && amountCents > sourceCents;
    transferWarn.style.display = insufficient ? 'block' : 'none';
    transferConfirm.disabled = !(amountCents > 0 && !insufficient);
  }

  transferAmtIn.addEventListener('input', validateTransferForm);

  transferConfirm.addEventListener('click', async () => {
    const amountCents = inputAmountToCents(transferAmtIn.value);
    if (!(amountCents > 0) || transferConfirm.disabled) return;
    const amt = centsToAmount(amountCents);

    transferConfirm.disabled = true;
    const origText = transferConfirm.textContent;
    transferConfirm.textContent = 'Transferring…';

    const fromType = transferDirection === 'c2o' ? 'cash' : 'online';
    const toType   = transferDirection === 'c2o' ? 'online' : 'cash';

    if (isAuthenticated()) {
      try {
        const fromW = getWalletByType(fromType);
        const toW   = getWalletByType(toType);
        if (!fromW || !toW) throw new Error('Wallets not found');

        const res = await authFetch(`${API_BASE}/wallets/transfer`, {
          method: 'POST',
          body: JSON.stringify({
            from_wallet_id: fromW.id,
            to_wallet_id: toW.id,
            amount: amt,
            note: `${fromType === 'cash' ? 'Cash' : 'Online'} to ${toType === 'cash' ? 'Cash' : 'Online'}`
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Transfer failed');

        await loadServerData();
        refreshBalanceDisplay();
        renderTransactions();
        buildCalendar();
        renderCalTxns();
        closeTransferModal();
        showToast(`✓ Transferred ₹${fmt(amt)} to ${toType === 'cash' ? 'Cash' : 'Online'} wallet!`);
      } catch (err) {
        showToast(`✗ ${err.message}`, 'error');
      } finally {
        transferConfirm.disabled = false;
        transferConfirm.textContent = origText;
      }
    } else {
      const db = getDB();
      const fromKey = fromType === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance';
      const toKey   = toType === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance';
      db[fromKey] = centsToAmount(amountToCents(db[fromKey] || 0) - amountCents);
      db[toKey]   = centsToAmount(amountToCents(db[toKey] || 0) + amountCents);
      const transferId = `offline-${window.crypto?.randomUUID ? window.crypto.randomUUID() : Date.now()}`;
      const date = new Date().toISOString();
      const direction = `${fromType === 'cash' ? 'Cash' : 'Online'} to ${toType === 'cash' ? 'Cash' : 'Online'}`;
      if (!db.transactions) db.transactions = [];
      db.transactions.unshift(
        { id: Date.now(), transfer_id: transferId, date, amount: amt, category: 'Transfer Out', category_emoji: '🔄', notes: direction, wallet: fromType, type: 'expense' },
        { id: Date.now() + 1, transfer_id: transferId, date, amount: amt, category: 'Transfer In', category_emoji: '🔄', notes: direction, wallet: toType, type: 'income' }
      );
      saveDB(db);
      refreshBalanceDisplay();
      renderTransactions();
      buildCalendar();
      renderCalTxns();
      closeTransferModal();
      showToast(`✓ Transferred ₹${fmt(amt)} to ${toType === 'cash' ? 'Cash' : 'Online'} wallet!`);
      transferConfirm.disabled = false;
      transferConfirm.textContent = origText;
    }
  });

  // 2. NOTIFICATIONS MODAL (#notif-btn)
  const notifModal = document.getElementById('notif-modal');
  const notifDynamic = document.getElementById('notif-dynamic-items');
  const notifStatusCard = document.querySelector('#notif-list-container > .notif-item');
  if (notifStatusCard) notifStatusCard.remove();

  document.getElementById('notif-btn').addEventListener('click', () => {
    const pending = (getOfflineDB().pendingLiabilities || []).filter(item => liabilityOutstandingCents(item) > 0);
    let dynamicHtml = '';
    pending.forEach(item => {
      const due = centsToAmount(liabilityOutstandingCents(item));
      dynamicHtml += `
        <div class="notif-item">
          <div class="notif-item-icon">\u23F3</div>
          <div class="notif-item-content">
            <div class="notif-item-title">Deferred Expense Outstanding</div>
            <div class="notif-item-desc">\u20B9${fmt(due)} remains for ${escapeHtml(item.category)}; due ${formatDate(item.dueDate)}.</div>
            <button class="txn-deferred-pay-btn notif-deferred-pay-btn" data-id="${escapeHtml(item.id)}" type="button" aria-label="Pay outstanding \u20B9${fmt(due)} for ${escapeHtml(item.category)}">Pay \u20B9${fmt(due)}</button>
          </div>
        </div>
      `;
    });

    if (isAuthenticated() && _khata.length > 0) {
      _khata.filter(k => (k.outstanding || 0) > 0).forEach(k => {
        dynamicHtml += `
          <div class="notif-item">
            <div class="notif-item-icon">\u{1F91D}</div>
            <div class="notif-item-content">
              <div class="notif-item-title">Khata Debt Outstanding</div>
              <div class="notif-item-desc">${escapeHtml(k.friend_name)} owes you \u20B9${fmt(k.outstanding)}.</div>
            </div>
          </div>
        `;
      });
    }

    notifDynamic.innerHTML = dynamicHtml || '<div class="notif-item"><div class="notif-item-content"><div class="notif-item-title">All caught up</div><div class="notif-item-desc">No reminders or outstanding repayments.</div></div></div>';
    notifDynamic.querySelectorAll('.notif-deferred-pay-btn').forEach(button => {
      button.addEventListener('click', () => {
        notifModal.classList.remove('open');
        openDeferredPayModal(button.dataset.id);
      });
    });
    notifModal.classList.add('open');
  });

  notifModal.addEventListener('click', (e) => {
    if (e.target === notifModal) notifModal.classList.remove('open');
  });

  // 3. MORE ACTIONS MODAL (#qa-more)
  const moreModal = document.getElementById('more-modal');
  document.getElementById('qa-more').addEventListener('click', () => {
    moreModal.classList.add('open');
  });
  moreModal.addEventListener('click', (e) => {
    if (e.target === moreModal) moreModal.classList.remove('open');
  });
  document.getElementById('more-action-transfer').addEventListener('click', () => {
    moreModal.classList.remove('open');
    openTransferModal();
  });
  document.getElementById('more-action-analytics').addEventListener('click', () => {
    moreModal.classList.remove('open');
    navigateToPage('calendar');
  });
  document.getElementById('more-action-budget').addEventListener('click', () => {
    moreModal.classList.remove('open');
    openBudgetModal();
  });
  document.getElementById('more-action-settings').addEventListener('click', () => {
    moreModal.classList.remove('open');
    navigateToPage('profile');
  });

  // 4. BUDGET OVERVIEW MODAL
  const budgetModal     = document.getElementById('budget-modal');
  const budgetSpentVal  = document.getElementById('budget-spent-val');
  const budgetAvailVal  = document.getElementById('budget-avail-val');
  const budgetProgress  = document.getElementById('budget-progress-bar');
  const budgetPctLabel  = document.getElementById('budget-pct-label');
  const budgetBreakdown = document.getElementById('budget-category-breakdown');

  function openBudgetModal() {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();

    const items = getAllTransactionItems().filter(t => {
      const d = new Date(t.date || t.dueDate);
      return d.getFullYear() === curYear && d.getMonth() === curMonth && t.type !== 'income';
    });

    const totalSpentCents = items.reduce((sum, t) => sum + (t._type === 'pending' ? t._outstandingCents : amountToCents(t.amount)), 0);
    const totalSpent = centsToAmount(totalSpentCents);
    const { total: totalAvail } = getTotalBalances();
    const combinedTotal = totalSpentCents + amountToCents(totalAvail);
    const spentPct = combinedTotal > 0 ? Math.min(Math.round((totalSpentCents / combinedTotal) * 100), 100) : 0;

    budgetSpentVal.textContent = `₹${fmt(totalSpent)}`;
    budgetAvailVal.textContent = `₹${fmt(totalAvail)}`;
    budgetProgress.style.width = `${spentPct}%`;
    budgetPctLabel.textContent = `${spentPct}% of capital spent`;

    // Group by category
    const catMap = new Map();
    items.forEach(t => {
      catMap.set(t.category, (catMap.get(t.category) || 0) + (t._type === 'pending' ? t._outstandingCents : amountToCents(t.amount)));
    });

    const catEntries = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
    if (catEntries.length === 0) {
      budgetBreakdown.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No expenses recorded this month yet.</div>';
    } else {
      budgetBreakdown.innerHTML = catEntries.map(([cat, cents]) => {
        const amt = centsToAmount(cents);
        const catPct = totalSpentCents > 0 ? Math.round((cents / totalSpentCents) * 100) : 0;
        const emoji = Object.prototype.hasOwnProperty.call(CATEGORY_EMOJI, cat) ? CATEGORY_EMOJI[cat] : '💳';
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span>${escapeHtml(emoji)}</span>
              <span style="font-size:13px;font-weight:700;color:var(--text-primary);">${escapeHtml(cat)}</span>
            </div>
            <div style="text-align:right;">
              <span style="font-size:13px;font-weight:800;color:var(--text-primary);">₹${fmt(amt)}</span>
              <span style="font-size:10px;color:var(--text-muted);margin-left:6px;">(${catPct}%)</span>
            </div>
          </div>
        `;
      }).join('');
    }

    budgetModal.classList.add('open');
  }

  budgetModal.addEventListener('click', (e) => {
    if (e.target === budgetModal) budgetModal.classList.remove('open');
  });

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      [transferModal, notifModal, budgetModal, moreModal, repayModal].forEach(m => {
        if (m && m.classList.contains('open')) m.classList.remove('open');
      });
      if (deferredPayModal.classList.contains('open')) closeDeferredPayModal();
    }
  });

  /* ══════════════════════════════════════════
     BOOT SEQUENCE
  ══════════════════════════════════════════ */
  initDB(); // Ensure DB exists on every load
  setTimeout(hideSplashAndStart, 1600);

})();
