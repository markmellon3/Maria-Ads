import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo, update, runTransaction, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let currentUser = null;
let walletData = { balance: 0, totalSpent: 0, totalDeposited: 0 };
let allCampaigns = [];
let allTransactions = [];
let billingInterval = null;
let isBillingInProgress = false;
let activeAdsUnsub = null;
let walletUnsub = null;
let txUnsub = null;
let isProcessingCampaign = {}; // Lock object for multi-tab safety per campaign

const BILLING_RATE = 0.020; // $0.020 per minute

// ==========================================
// INITIALIZATION
// ==========================================

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        initializeWallet();
        setupEventListeners();
    } else {
        cleanupBilling();
        window.location.href = 'login.html';
    }
});

function setupEventListeners() {
    document.getElementById('refresh-wallet-btn').addEventListener('click', () => {
        showNotification('Wallet refreshed.', 'info');
        updateBillingUI();
    });
    
    document.getElementById('add-funds-btn').addEventListener('click', () => {
        // Preserve existing Add Funds functionality
        showModal('Add Funds', `
            <form id="add-funds-form">
                <div class="form-group">
                    <label>Amount ($)</label>
                    <input type="number" id="funds-amount" min="1" step="0.01" value="10" required>
                </div>
            </form>
        `, [
            { label: 'Cancel', class: 'btn-outline', onClick: (modal, close) => close() },
            { 
                label: 'Deposit', 
                class: 'btn-success', 
                onClick: async (modal, close) => {
                    const amount = parseFloat(document.getElementById('funds-amount').value);
                    if (amount > 0) {
                        await processDeposit(amount);
                        close();
                    }
                }
            }
        ]);
    });

    document.getElementById('tx-type-filter').addEventListener('change', renderTransactions);
}

// ==========================================
// REALTIME LISTENERS
// ==========================================

function initializeWallet() {
    if (!currentUser) return;

    // 1. Listen to Wallet Data
    const walletRef = ref(database, 'users/' + currentUser.uid);
    walletUnsub = onValue(walletRef, (snapshot) => {
        const data = snapshot.val() || {};
        walletData = {
            balance: Number(data.balance) || 0,
            totalSpent: Number(data.totalSpent) || 0,
            totalDeposited: Number(data.totalDeposited) || 0
        };
        updateWalletUI();
    });

    // 2. Listen to Campaigns (Fetch all, filter client-side to avoid missing indexes)
    const campaignsRef = ref(database, 'campaigns');
    activeAdsUnsub = onValue(campaignsRef, (snapshot) => {
        allCampaigns = [];
        if (snapshot.exists()) {
            const allData = snapshot.val();
            for (const id in allData) {
                if (allData[id].advertiserId === currentUser.uid) {
                    allCampaigns.push({ id, ...allData[id] });
                }
            }
        }
        renderActiveAds();
        updateBillingUI();
    });

    // 3. Listen to Transactions
    const txRef = ref(database, 'transactions');
    txUnsub = onValue(txRef, (snapshot) => {
        allTransactions = [];
        if (snapshot.exists()) {
            const allData = snapshot.val();
            for (const id in allData) {
                if (allData[id].userId === currentUser.uid) {
                    allTransactions.push({ id, ...allData[id] });
                }
            }
            allTransactions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
        renderTransactions();
        updateWalletUI(); // Update today's spend
    });

    // 4. Start Billing Engine
    startLiveBilling();
}

function cleanupBilling() {
    if (billingInterval) clearInterval(billingInterval);
    if (activeAdsUnsub) activeAdsUnsub();
    if (walletUnsub) walletUnsub();
    if (txUnsub) txUnsub();
    billingInterval = null;
}

// ==========================================
// LIVE BILLING ENGINE
// ==========================================

function startLiveBilling() {
    if (billingInterval) clearInterval(billingInterval);
    // Run every 15 seconds to check for elapsed time accurately
    billingInterval = setInterval(runBillingCycle, 15000);
}

async function runBillingCycle() {
    if (isBillingInProgress) return;
    const user = auth.currentUser;
    if (!user) return;

    isBillingInProgress = true;

    try {
        const now = Date.now();
        const activeAds = allCampaigns.filter(c => c.status === 'active');

        for (const ad of activeAds) {
            if (isProcessingCampaign[ad.id]) continue; // Skip if already processing this ad
            isProcessingCampaign[ad.id] = true;
            
            try {
                await processAdBilling(ad, now);
            } finally {
                isProcessingCampaign[ad.id] = false;
            }
        }
        
        updateLastBillingCycle(now);
    } catch (error) {
        console.error('[Billing Engine] Error during cycle:', error);
    } finally {
        isBillingInProgress = false;
    }
}

async function processAdBilling(camp, now) {
    // 1. Initialize billing tracker if it doesn't exist
    if (!camp.billing || !camp.billing.lastBilledAt) {
        const billingRef = ref(database, `campaigns/${camp.id}/billing`);
        await update(billingRef, {
            lastBilledAt: now,
            activeMinutes: 0,
            totalBilled: 0
        });
        
        if (!camp.billing) camp.billing = {};
        camp.billing.lastBilledAt = now;
        return; // Wait for next cycle to start charging
    }

    const lastBilledAt = camp.billing.lastBilledAt;
    const elapsedMs = now - lastBilledAt;
    const billableMinutes = Math.floor(elapsedMs / 60000); // Only charge whole minutes

    if (billableMinutes <= 0) return;

    const charge = billableMinutes * BILLING_RATE;

    // 2. Secure billing window via Transaction (Prevents multi-tab double billing)
    const lockRef = ref(database, `campaigns/${camp.id}/billing/lastBilledAt`);
    const lockResult = await runTransaction(lockRef, (currLock) => {
        if (currLock === lastBilledAt) {
            return lastBilledAt + (billableMinutes * 60000);
        }
        return; // Abort if another tab changed it
    });

    if (!lockResult.committed) {
        return; // Another tab/process billed this period
    }

    // 3. Attempt Wallet Deduction (Atomic)
    const balanceRef = ref(database, 'users/' + currentUser.uid + '/balance');
    const balResult = await runTransaction(balanceRef, (currBal) => {
        const balance = Number(currBal) || 0;
        if (balance >= charge) {
            return balance - charge;
        }
        return; // Abort, insufficient funds
    });

    if (!balResult.committed) {
        // Insufficient Funds: Pause Campaign
        await update(ref(database, 'campaigns/' + camp.id), { status: 'paused' });
        showNotification('Insufficient Balance', `Campaign "${camp.name}" paused due to low funds.`, 'error');
        return;
    }

    // 4. Update Total Spent
    const totalSpentRef = ref(database, 'users/' + currentUser.uid + '/totalSpent');
    await runTransaction(totalSpentRef, (curr) => (Number(curr) || 0) + charge);

    // 5. Update Campaign Spend & Billing Stats
    const newSpent = (Number(camp.spent) || 0) + charge;
    const updates = {};
    updates[`campaigns/${camp.id}/spent`] = newSpent;
    updates[`campaigns/${camp.id}/billing/activeMinutes`] = (camp.billing.activeMinutes || 0) + billableMinutes;
    updates[`campaigns/${camp.id}/billing/totalBilled`] = (camp.billing.totalBilled || 0) + charge;
    await update(ref(database), updates);

    // 6. Create Transaction Record
    const newTxRef = push(ref(database, 'transactions'));
    await set(newTxRef, {
        userId: currentUser.uid,
        campaignId: camp.id,
        campaignName: camp.name || 'Unnamed',
        type: 'ad_spending',
        amount: -charge,
        durationMinutes: billableMinutes,
        ratePerMinute: BILLING_RATE,
        status: 'completed',
        createdAt: now
    });

    // Update local state to reflect immediately
    camp.spent = newSpent;
    camp.billing.lastBilledAt = lockResult.snapshot.val();
    camp.billing.activeMinutes += billableMinutes;
    camp.billing.totalBilled += charge;
}

// ==========================================
// DEPOSITS
// ==========================================

async function processDeposit(amount) {
    try {
        const updates = {};
        
        // 1. Update Wallet Balance
        updates[`users/${currentUser.uid}/balance`] = (walletData.balance || 0) + amount;
        updates[`users/${currentUser.uid}/totalDeposited`] = (walletData.totalDeposited || 0) + amount;
        await update(ref(database), updates);

        // 2. Create Transaction Record
        const newTxRef = push(ref(database, 'transactions'));
        await set(newTxRef, {
            userId: currentUser.uid,
            type: 'deposit',
            amount: amount,
            status: 'completed',
            createdAt: Date.now()
        });

        showNotification(`$${amount.toFixed(2)} added successfully!`, 'success');
    } catch (error) {
        console.error('Deposit failed:', error);
        showNotification('Deposit failed.', 'error');
    }
}

// ==========================================
// UI RENDERING
// ==========================================

function updateWalletUI() {
    document.getElementById('wallet-balance').textContent = formatCurrency(walletData.balance || 0);
    document.getElementById('wallet-deposited').textContent = formatCurrency(walletData.totalDeposited || 0);
    document.getElementById('wallet-spent').textContent = formatCurrency(walletData.totalSpent || 0);

    // Calculate Today's Spend
    const startOfDay = new Date().setHours(0,0,0,0);
    const todaySpend = allTransactions
        .filter(t => t.type === 'ad_spending' && t.createdAt >= startOfDay)
        .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
    
    document.getElementById('wallet-today-spend').textContent = formatCurrency(todaySpend);
}

function updateBillingUI() {
    const activeAds = allCampaigns.filter(c => c.status === 'active');
    const count = activeAds.length;
    const rate = count * BILLING_RATE;

    document.getElementById('active-ad-count').textContent = count;
    document.getElementById('current-spend-rate').textContent = `$${rate.toFixed(3)} / min`;

    const stateIndicator = document.getElementById('billing-state-indicator');
    if (walletData.balance <= 0 && count > 0) {
        stateIndicator.className = 'billing-state paused';
        stateIndicator.textContent = 'Billing Paused — Insufficient Balance';
    } else if (count === 0) {
        stateIndicator.className = 'billing-state no-ads';
        stateIndicator.textContent = 'No Active Advertisements';
    } else {
        stateIndicator.className = 'billing-state active';
        stateIndicator.textContent = 'Billing Active';
    }
}

function updateLastBillingCycle(timestamp) {
    if (timestamp) {
        document.getElementById('last-billing-cycle').textContent = new Date(timestamp).toLocaleTimeString();
    }
}

function renderActiveAds() {
    const activeAds = allCampaigns.filter(c => c.status === 'active');
    const tbody = document.getElementById('active-ads-tbody');
    const cardsContainer = document.getElementById('active-ads-cards');

    if (activeAds.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No active advertisements.</td></tr>`;
        cardsContainer.innerHTML = `<div class="text-center text-muted p-2">No active advertisements.</div>`;
        return;
    }

    // Desktop Table
    tbody.innerHTML = activeAds.map(c => {
        const activeMins = c.billing?.activeMinutes || 0;
        const spent = c.spent || 0;
        const lastBilled = c.billing?.lastBilledAt ? formatDate(c.billing.lastBilledAt) : 'N/A';
        
        return `
            <tr>
                <td><strong>${escapeHtml(c.name || 'Unnamed')}</strong></td>
                <td><span class="status-badge status-active">Active</span></td>
                <td>${activeMins} min</td>
                <td>$${BILLING_RATE.toFixed(3)} / min</td>
                <td>${formatCurrency(spent)}</td>
                <td>${lastBilled}</td>
                <td>
                    <button class="action-btn" onclick="window.viewCampaignBilling('${c.id}')">Details</button>
                </td>
            </tr>
        `;
    }).join('');

    // Mobile Cards
    cardsContainer.innerHTML = activeAds.map(c => {
        const activeMins = c.billing?.activeMinutes || 0;
        const spent = c.spent || 0;
        
        return `
            <div class="mobile-card">
                <div class="mobile-card-header">
                    <h3>${escapeHtml(c.name || 'Unnamed')}</h3>
                    <span class="status-badge status-active">Active</span>
                </div>
                <div class="mobile-card-stats">
                    <span>Active Time: ${activeMins} min</span>
                    <span>Rate: $${BILLING_RATE.toFixed(3)}/min</span>
                    <span>Spent: ${formatCurrency(spent)}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderTransactions() {
    const filter = document.getElementById('tx-type-filter').value;
    const tbody = document.getElementById('wallet-transactions-tbody');
    
    let filteredTx = allTransactions;
    if (filter !== 'all') {
        filteredTx = allTransactions.filter(t => t.type === filter);
    }

    if (filteredTx.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No transactions found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredTx.map(t => {
        const isDeposit = t.type === 'deposit' || t.amount > 0;
        const amountClass = isDeposit ? 'text-success' : 'text-danger';
        const sign = isDeposit ? '+' : '';
        
        return `
            <tr>
                <td>${formatDate(t.createdAt)}</td>
                <td><span class="status-badge status-${t.type}">${escapeHtml(t.type.replace('_', ' '))}</span></td>
                <td class="${amountClass}"><strong>${sign}${formatCurrency(t.amount)}</strong></td>
                <td>${escapeHtml(t.status || 'completed')}</td>
                <td>${t.campaignId ? escapeHtml(t.campaignId.substring(0,8)) + '...' : 'N/A'}</td>
                <td><button class="action-btn" onclick="window.viewTransactionDetails('${t.id}')">View</button></td>
            </tr>
        `;
    }).join('');
}

// ==========================================
// MODAL VIEWS
// ==========================================

window.viewCampaignBilling = function(id) {
    const camp = allCampaigns.find(c => c.id === id);
    if (!camp) return;

    showModal('Campaign Billing Details', `
        <div class="detail-grid">
            <div class="detail-item"><label>Campaign</label><span>${escapeHtml(camp.name || 'N/A')}</span></div>
            <div class="detail-item"><label>Status</label><span class="status-badge status-${camp.status}">${camp.status}</span></div>
            <div class="detail-item"><label>Billing Rate</label><span>$${BILLING_RATE.toFixed(3)} / minute</span></div>
            <div class="detail-item"><label>Active Time</label><span>${camp.billing?.activeMinutes || 0} minutes</span></div>
            <div class="detail-item"><label>Total Billed</label><span>${formatCurrency(camp.billing?.totalBilled || 0)}</span></div>
            <div class="detail-item"><label>Last Billed</label><span>${camp.billing?.lastBilledAt ? formatDate(camp.billing.lastBilledAt) : 'N/A'}</span></div>
        </div>
    `, [
        { label: 'Close', class: 'btn-outline', onClick: (modal, close) => close() }
    ]);
};

window.viewTransactionDetails = function(id) {
    const tx = allTransactions.find(t => t.id === id);
    if (!tx) return;

    const isDeposit = tx.type === 'deposit' || tx.amount > 0;
    const sign = isDeposit ? '+' : '';

    showModal('Transaction Details', `
        <div class="detail-grid">
            <div class="detail-item"><label>Date</label><span>${formatDate(tx.createdAt)}</span></div>
            <div class="detail-item"><label>Type</label><span>${escapeHtml(tx.type.replace('_', ' '))}</span></div>
            <div class="detail-item"><label>Amount</label><span class="${isDeposit ? 'text-success' : 'text-danger'}">${sign}${formatCurrency(tx.amount)}</span></div>
            <div class="detail-item"><label>Status</label><span>${escapeHtml(tx.status || 'completed')}</span></div>
            ${tx.campaignId ? `<div class="detail-item" style="grid-column: span 2;"><label>Campaign</label><span>${escapeHtml(tx.campaignName || tx.campaignId)}</span></div>` : ''}
            ${tx.durationMinutes ? `<div class="detail-item"><label>Duration</label><span>${tx.durationMinutes} minutes</span></div>` : ''}
            <div class="detail-item" style="grid-column: span 2;"><label>Reference</label><span>${tx.id}</span></div>
        </div>
    `, [
        { label: 'Close', class: 'btn-outline', onClick: (modal, close) => close() }
    ]);
};
