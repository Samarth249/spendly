/* ═══════════════════════════════════════════════════════
   SPENDLY – PHASE 1 + 2 + 3  |  Vanilla JS App Controller
═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════
     CONSTANTS
  ══════════════════════════════════════════ */
  const CORRECT_PIN       = '1234';
  const LS_PERSONA_KEY    = 'spendly_persona';
  const LS_ONBOARDED_KEY  = 'spendly_onboarded';
  const LS_DB_KEY         = 'spendly_db';

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
     DATABASE — LocalStorage
  ══════════════════════════════════════════ */
  function initDB() {
    if (!localStorage.getItem(LS_DB_KEY)) {
      const defaultDB = {
        currentCashBalance:   0,
        currentOnlineBalance: 0,
        transactions:        [],
        pendingLiabilities:  [],
        lentRecords:         []
      };
      localStorage.setItem(LS_DB_KEY, JSON.stringify(defaultDB));
    } else {
      // Migrate: add missing fields
      const db = JSON.parse(localStorage.getItem(LS_DB_KEY));
      let dirty = false;
      if (!db.pendingLiabilities) { db.pendingLiabilities = []; dirty = true; }
      if (!db.lentRecords)        { db.lentRecords        = []; dirty = true; }
      if (dirty) localStorage.setItem(LS_DB_KEY, JSON.stringify(db));
    }
  }

  function getDB() {
    try {
      return JSON.parse(localStorage.getItem(LS_DB_KEY));
    } catch {
      initDB();
      return JSON.parse(localStorage.getItem(LS_DB_KEY));
    }
  }

  function saveDB(db) {
    localStorage.setItem(LS_DB_KEY, JSON.stringify(db));
  }

  /* ══════════════════════════════════════════
     APP STATE
  ══════════════════════════════════════════ */
  let pinBuffer       = '';
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
  const tabOverview    = document.getElementById('tab-overview');
  const tabCalendar    = document.getElementById('tab-calendar');
  const tabSettings    = document.getElementById('tab-settings');
  const overviewSec    = document.getElementById('overview-section');
  const calendarSec    = document.getElementById('calendar-section');
  const settingsSec    = document.getElementById('settings-section');
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
    setTimeout(() => {
      splash.style.display = 'none';
      pinScreen.classList.add('active');
    }, 520);
  }

  /* ══════════════════════════════════════════
     NUMBER FORMATTER
  ══════════════════════════════════════════ */
  function fmt(num) {
    return new Intl.NumberFormat('en-IN').format(num);
  }

  /* ══════════════════════════════════════════
     BALANCE DISPLAY — Reactive Update
  ══════════════════════════════════════════ */
  function refreshBalanceDisplay() {
    const db    = getDB();
    const cash  = db.currentCashBalance   || 0;
    const online= db.currentOnlineBalance || 0;
    const total = cash + online;

    // Animate number change
    animateCounter(totalBalanceEl,  total);
    animateCounter(cashBalanceEl,   cash);
    animateCounter(onlineBalanceEl, online);
  }

  function animateCounter(el, targetVal) {
    const start    = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
    const end      = targetVal;
    const duration = 500;
    const startTs  = performance.now();

    function step(ts) {
      const progress = Math.min((ts - startTs) / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current  = Math.round(start + (end - start) * ease);
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
    const val = parseFloat(amountInput.value);
    confirmBtn.disabled = !(val && val > 0);
    if (!amountInput.value) {
      quickAmounts.forEach(q => q.classList.remove('selected'));
    }
  });

  // Confirm — write to DB
  confirmBtn.addEventListener('click', () => {
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) return;

    const db = getDB();
    if (activeWallet === 'cash') {
      db.currentCashBalance = (db.currentCashBalance || 0) + amount;
    } else {
      db.currentOnlineBalance = (db.currentOnlineBalance || 0) + amount;
    }
    saveDB(db);

    const label = activeWallet === 'cash' ? 'Cash Wallet' : 'Online Wallet';
    showToast(`✓ ₹${fmt(amount)} added to ${label}`);
    closeModal();
    refreshBalanceDisplay();
  });

  /* ══════════════════════════════════════════
     PIN LOGIC
  ══════════════════════════════════════════ */
  function updateDots() {
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < pinBuffer.length);
      dot.classList.remove('error');
    });
  }

  function pinSuccess() {
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
    dots.forEach(d => d.classList.add('error'));
    pinDotsEl.classList.add('shake');
    pinErrorEl.classList.add('show');
    setTimeout(() => {
      pinDotsEl.classList.remove('shake');
      pinBuffer = '';
      updateDots();
      setTimeout(() => pinErrorEl.classList.remove('show'), 800);
    }, 500);
  }

  function handleKeyPress(digit) {
    if (pinBuffer.length >= 4) return;
    pinBuffer += digit;
    updateDots();
    if (pinBuffer.length === 4) {
      pinBuffer === CORRECT_PIN ? pinSuccess() : setTimeout(pinError, 80);
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
    const persona = localStorage.getItem(LS_PERSONA_KEY) || 'Student';
    const personaMap = {
      'Student':        { emoji: '🎓', cls: 'student',  initial: 'S' },
      'Salaried':       { emoji: '💼', cls: 'salaried', initial: 'S' },
      'Business Owner': { emoji: '🏢', cls: 'business', initial: 'B' },
    };
    const pm = personaMap[persona] || personaMap['Student'];
    personaPillEl.className   = `persona-pill ${pm.cls}`;
    personaPillEl.textContent = `${pm.emoji} ${persona}`;
    avatarEl.textContent      = pm.initial;

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
  document.getElementById('nav-add').addEventListener('click', openExpenseModal);

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
    const amount = parseFloat(expAmountInput.value);
    const db     = getDB();
    const balance = expWallet === 'cash'
      ? (db.currentCashBalance   || 0)
      : (db.currentOnlineBalance || 0);

    const insufficient = amount > 0 && amount > balance;
    balWarn.style.display = insufficient ? 'block' : 'none';

    const valid = amount > 0 && expCategory.value && !insufficient;
    expSaveBtn.disabled = !valid;
  }

  // Save expense
  expSaveBtn.addEventListener('click', () => {
    const amount   = parseFloat(expAmountInput.value);
    const category = expCategory.value;
    const notes    = expNotes.value.trim();
    if (!amount || !category) return;

    const db = getDB();
    const balKey = expWallet === 'cash' ? 'currentCashBalance' : 'currentOnlineBalance';
    if ((db[balKey] || 0) < amount) {
      showToast('⚠ Insufficient balance!', 'error');
      return;
    }

    const isKhata = expKhataChk.checked;
    const friendName = isKhata ? (expFriendName.value.trim() || 'Unknown') : '';
    const isSplit = !isKhata && expSplitChk.checked;
    const nowAmount = isSplit ? Math.ceil(amount / 2) : amount;
    const deferAmt  = isSplit ? Math.floor(amount / 2) : 0;

    // Deduct from wallet in all cases
    db[balKey] = (db[balKey] || 0) - nowAmount;

    if (isKhata) {
      // Log as a lent record, NOT as an expense transaction
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
      db.transactions.unshift(txn);

      // If split, create a pending liability for next month 1st
      if (isSplit && deferAmt > 0) {
        const nextMonthFirst = new Date();
        nextMonthFirst.setDate(1);
        nextMonthFirst.setMonth(nextMonthFirst.getMonth() + 1);
        nextMonthFirst.setHours(0, 0, 0, 0);
        if (!db.pendingLiabilities) db.pendingLiabilities = [];
        db.pendingLiabilities.unshift({
          id:         Date.now() + 1,
          dueDate:    nextMonthFirst.toISOString(),
          amount:     deferAmt,
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
    closeExpenseModal();

    let toastMsg;
    if (isKhata)       toastMsg = `🤝 ₹${fmt(amount)} lent to ${friendName}`;
    else if (isSplit)  toastMsg = `✓ ₹${fmt(nowAmount)} paid · ₹${fmt(deferAmt)} deferred`;
    else               toastMsg = `✓ ₹${fmt(amount)} — ${category}`;
    showToast(toastMsg, isKhata ? 'info' : isSplit ? 'info' : 'success');
  });

  /* ══════════════════════════════════════════
     TRANSACTION RENDERER
  ══════════════════════════════════════════ */
  function formatDate(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString())     return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
  }

  function renderTransactions() {
    const db        = getDB();
    const txns      = db.transactions     || [];
    const pending   = db.pendingLiabilities || [];
    const allItems  = [
      ...txns.map(t => ({ ...t, _type: 'txn' })),
      ...pending.map(p => ({ ...p, _type: 'pending', date: p.dueDate }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);

    if (allItems.length === 0) {
      txnEmptyEl.style.display = 'flex';
      txnListEl.innerHTML = '';
      return;
    }

    txnEmptyEl.style.display = 'none';

    txnListEl.innerHTML = allItems.map((t, i) => {
      const isPending   = t._type === 'pending';
      const emoji       = CATEGORY_EMOJI[t.category] || '💰';
      const walletKey   = t.wallet || t.fromWallet || 'cash';
      const walletDot   = walletKey === 'cash' ? 'cash' : 'online';
      const walletLabel = walletKey === 'cash' ? 'Cash' : 'Online';
      const dateStr     = formatDate(t.date);
      const noteStr     = t.notes ? ` · ${t.notes}` : '';
      const badge       = isPending ? `<div class="txn-pending-badge">⏳ Deferred – Due ${formatDate(t.date)}</div>` : '';
      const amtCls      = isPending ? 'txn-amount pending-amt' : 'txn-amount';
      const prefix      = isPending ? '~' : '−';
      return `
        <div class="txn-item${isPending ? ' pending' : ''}" style="animation-delay:${i * 0.04}s">
          <div class="txn-icon">${emoji}</div>
          <div class="txn-details">
            <div class="txn-category">${t.category}</div>
            ${badge}
            <div class="txn-meta">
              <span class="txn-wallet-dot ${walletDot}"></span>
              ${walletLabel}${noteStr} · ${dateStr}
            </div>
          </div>
          <div class="${amtCls}">${prefix}₹${fmt(t.amount)}</div>
        </div>
      `;
    }).join('');
  }

  /* ══════════════════════════════════════════
     PHASE 4A — SPLIT PAYMENT
  ══════════════════════════════════════════ */
  expSplitChk.addEventListener('change', () => {
    const amount = parseFloat(expAmountInput.value) || 0;
    if (expSplitChk.checked) {
      splitInfoPanel.classList.add('visible');
      updateSplitPreview(amount);
    } else {
      splitInfoPanel.classList.remove('visible');
    }
    validateExpForm();
  });

  // Also update split preview when amount changes while split is checked
  expAmountInput.addEventListener('input', () => {
    if (expSplitChk.checked) {
      updateSplitPreview(parseFloat(expAmountInput.value) || 0);
    }
  }, true); // capture = true so it runs before the existing listener

  function updateSplitPreview(amount) {
    const half = amount / 2;
    splitNowAmt.textContent   = `₹${fmt(Math.ceil(half))}`;
    splitLaterAmt.textContent = `₹${fmt(Math.floor(half))}`;
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
    const db      = getDB();
    const year    = calViewDate.getFullYear();
    const month   = calViewDate.getMonth();
    const today   = new Date();

    calMonthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;

    // Collect days that have transactions in this month
    const expenseDays = new Set();
    (db.transactions || []).forEach(t => {
      const d = new Date(t.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        expenseDays.add(d.getDate());
      }
    });
    // Also include pending liabilities due this month
    (db.pendingLiabilities || []).forEach(p => {
      const d = new Date(p.dueDate);
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
          // deselect
          calFilterDay = null;
        } else {
          calFilterDay = ymd;
        }
        buildCalendar();
        renderCalTxns();
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
    const db   = getDB();
    let txns   = [...(db.transactions || []), ...(db.pendingLiabilities || []).map(p => ({...p, _pending: true}))];

    // Filter to current calendar month
    txns = txns.filter(t => {
      const d = new Date(t.date || t.dueDate);
      return d.getFullYear() === calViewDate.getFullYear() && d.getMonth() === calViewDate.getMonth();
    });

    // Further filter by selected day
    if (calFilterDay) {
      txns = txns.filter(t => {
        const d = new Date(t.date || t.dueDate);
        return toYMD(d) === calFilterDay;
      });
      calTxnTitle.textContent = 'On This Day';
    } else {
      calTxnTitle.textContent = 'All This Month';
    }

    // Sort newest first
    txns.sort((a, b) => new Date(b.date || b.dueDate) - new Date(a.date || a.dueDate));

    if (txns.length === 0) {
      calTxnEmpty.style.display = 'flex';
      calTxnList.innerHTML = '';
      return;
    }
    calTxnEmpty.style.display = 'none';

    calTxnList.innerHTML = txns.map((t, i) => {
      const emoji      = CATEGORY_EMOJI[t.category] || '💰';
      const walletDot  = (t.wallet || t.fromWallet) === 'cash' ? 'cash' : 'online';
      const walletLbl  = (t.wallet || t.fromWallet) === 'cash' ? 'Cash' : 'Online';
      const dateStr    = formatDate(t.date || t.dueDate);
      const noteStr    = t.notes ? ` · ${t.notes}` : '';
      const isPending  = !!t._pending;
      const amtCls     = isPending ? 'txn-amount pending-amt' : 'txn-amount';
      const badge      = isPending ? `<div class="txn-pending-badge">⏳ Deferred</div>` : '';
      return `
        <div class="txn-item${isPending ? ' pending' : ''}" style="animation-delay:${i*0.04}s">
          <div class="txn-icon">${emoji}</div>
          <div class="txn-details">
            <div class="txn-category">${t.category}</div>
            ${badge}
            <div class="txn-meta">
              <span class="txn-wallet-dot ${walletDot}"></span>
              ${walletLbl}${noteStr} · ${dateStr}
            </div>
          </div>
          <div class="${amtCls}">${isPending ? '~' : '−'}₹${fmt(t.amount)}</div>
        </div>
      `;
    }).join('');
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

  // Dashboard tab switching helper
  function switchDashTab(active) {
    [tabOverview, tabCalendar, tabSettings].forEach(t => t.classList.remove('active'));
    active.classList.add('active');
    overviewSec.classList.toggle('hidden',  active !== tabOverview);
    calendarSec.classList.toggle('visible', active === tabCalendar);
    settingsSec.classList.toggle('visible', active === tabSettings);
  }

  tabOverview.addEventListener('click',  () => switchDashTab(tabOverview));
  tabCalendar.addEventListener('click',  () => {
    switchDashTab(tabCalendar);
    calViewDate = new Date(); calFilterDay = null;
    buildCalendar(); renderCalTxns();
  });
  tabSettings.addEventListener('click',  () => switchDashTab(tabSettings));

  /* ── Bottom Nav Tab switching ── */
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', function () {
      navItems.forEach(n => { n.classList.remove('active'); n.removeAttribute('aria-current'); });
      this.classList.add('active');
      this.setAttribute('aria-current', 'page');
    });
  });

  // Analytics nav → jump to calendar tab
  document.getElementById('nav-analytics').addEventListener('click', () => tabCalendar.click());

  // Profile nav → jump to settings tab
  document.getElementById('nav-profile').addEventListener('click',   () => tabSettings.click());

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
     PHASE 5A — KHATA (WHO OWES ME)
  ══════════════════════════════════════════ */

  // Show/hide friend name field when Khata toggle flips
  expKhataChk.addEventListener('change', () => {
    khataFriendField.classList.toggle('visible', expKhataChk.checked);
    // Khata and Split are mutually exclusive
    if (expKhataChk.checked) {
      expSplitChk.checked = false;
      splitInfoPanel.classList.remove('visible');
    }
    validateExpForm();
  });

  // Render the "Who Owes Me" section
  function renderKhata() {
    const db      = getDB();
    const records = db.lentRecords || [];

    if (records.length === 0) {
      khataSection.style.display = 'none';
      return;
    }
    khataSection.style.display = 'block';

    // Group by friend name, sum amounts
    const grouped = {};
    records.forEach(r => {
      const key = r.friendName.trim().toLowerCase();
      if (!grouped[key]) grouped[key] = { name: r.friendName, total: 0, count: 0, date: r.date };
      grouped[key].total += r.amount;
      grouped[key].count++;
      if (new Date(r.date) > new Date(grouped[key].date)) grouped[key].date = r.date;
    });

    khataList.innerHTML = Object.values(grouped).map((g, i) => `
      <div class="khata-card" style="margin-bottom:8px;animation-delay:${i*0.05}s">
        <div class="khata-avatar">${g.name.charAt(0).toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div class="khata-friend-name">${g.name}</div>
          <div class="khata-friend-meta">${g.count} payment${g.count>1?'s':''} · ${formatDate(g.date)}</div>
        </div>
        <div class="khata-friend-amt">₹${fmt(g.total)}</div>
      </div>
    `).join('');
  }

  // Clear all khata records
  khataClearBtn.addEventListener('click', () => {
    if (!confirm('Remove all "Who Owes Me" records?')) return;
    const db = getDB();
    db.lentRecords = [];
    saveDB(db);
    renderKhata();
    showToast('✓ Khata book cleared');
  });

  /* ══════════════════════════════════════════
     PHASE 5B — DATA SAFETY (EXPORT / IMPORT)
  ══════════════════════════════════════════ */

  // ── EXPORT ──
  document.getElementById('btn-export').addEventListener('click', () => {
    const db    = getDB();
    const json  = JSON.stringify(db, null, 2);
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

  // ── IMPORT ──
  document.getElementById('btn-import').addEventListener('click', () => {
    importFileInput.value = ''; // reset so same file can be re-selected
    importFileInput.click();
  });

  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        // Validate required shape
        const valid = (
          typeof parsed.currentCashBalance   === 'number' &&
          typeof parsed.currentOnlineBalance === 'number' &&
          Array.isArray(parsed.transactions)
        );
        if (!valid) throw new Error('Invalid structure');

        // Ensure all optional arrays exist
        if (!parsed.pendingLiabilities) parsed.pendingLiabilities = [];
        if (!parsed.lentRecords)        parsed.lentRecords        = [];

        localStorage.setItem(LS_DB_KEY, JSON.stringify(parsed));
        refreshBalanceDisplay();
        renderTransactions();
        renderKhata();
        showToast('✓ Data imported successfully!', 'success');
      } catch {
        showToast('✗ Invalid backup file — import failed', 'error');
      }
    };
    reader.readAsText(file);
  });

  // ── Clear khata from settings ──
  document.getElementById('btn-clear-khata-settings').addEventListener('click', () => {
    if (!confirm('Remove all "Who Owes Me" records?')) return;
    const db = getDB();
    db.lentRecords = [];
    saveDB(db);
    renderKhata();
    showToast('✓ Khata book cleared');
  });

  // ── Reset All ──
  document.getElementById('btn-reset-all').addEventListener('click', () => {
    if (!confirm('⚠ This will DELETE all your data. Are you sure?')) return;
    localStorage.removeItem(LS_DB_KEY);
    initDB();
    refreshBalanceDisplay();
    renderTransactions();
    renderKhata();
    showToast('✓ All data reset', 'info');
  });

  /* ══════════════════════════════════════════
     BOOT SEQUENCE
  ══════════════════════════════════════════ */
  initDB(); // Ensure DB exists on every load
  setTimeout(hideSplashAndStart, 1600);

})();
