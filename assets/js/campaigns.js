import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo, update, runTransaction, set, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let allCampaigns = [];

// Billing State Variables
let isBillingInProgress = false;
let billingInterval = null;
let totalBilledThisSession = 0;
let liveFeedData = [];

async function loadCampaigns() {
    const user = auth.currentUser;
    if (!user) return;

    const tbody = document.getElementById('campaigns-tbody');
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading campaigns...</td></tr>';

    try {
        const campaignsRef = ref(database, 'campaigns');
        const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(user.uid));
        const snapshot = await get(userCampaignsQuery);

        if (snapshot.exists()) {
            allCampaigns = Object.entries(snapshot.val()).map(([id, data]) => ({ id, ...data }));
            renderCampaigns('all');
            setupFilters();
        } else {
            allCampaigns = [];
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">No campaigns found. <a href="create-ad.html">Create one!</a></td></tr>';
        }
    } catch (error) {
        console.error("Error fetching campaigns:", error);
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading campaigns.</td></tr>';
    }
}

function setupFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.getAttribute('data-filter');
            renderCampaigns(filter);
        });
    });
}

function renderCampaigns(filter) {
    const tbody = document.getElementById('campaigns-tbody');
    tbody.innerHTML = '';

    const filtered = filter === 'all' ? allCampaigns : allCampaigns.filter(c => c.status === filter);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center">No ${filter} campaigns.</td></tr>`;
        return;
    }

    filtered.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(c.name)}</td>
            <td><span class="status-badge status-${c.status}">${c.status}</span></td>
            <td>${formatCurrency(c.budget)}</td>
            <td>${formatCurrency(c.spent)}</td>
            <td>${c.impressions || 0}</td>
            <td>${c.clicks || 0}</td>
            <td>${calculateCTR(c.clicks || 0, c.impressions || 0)}</td>
            <td>${formatDate(c.startDate)}</td>
            <td>${formatDate(c.endDate)}</td>
            <td>
                ${c.status === 'active' 
                    ? `<button class="btn btn-sm btn-warning" data-action="pause" data-id="${c.id}">Pause</button>`
                    : `<button class="btn btn-sm btn-success" data-action="activate" data-id="${c.id}">Activate</button>`
                }
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attach action listeners
    tbody.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.getAttribute('data-action');
            const id = e.target.getAttribute('data-id');
            handleCampaignAction(id, action);
        });
    });
}

function handleCampaignAction(id, action) {
    const newStatus = action === 'pause' ? 'paused' : 'active';
    const actionText = action === 'pause' ? 'Pause' : 'Activate';

    showModal(`Confirm ${actionText}`, `<p>Are you sure you want to ${actionText} this campaign?</p>`, [
        {
            label: 'Cancel',
            class: 'btn-secondary',
            onClick: (modal, close) => close()
        },
        {
            label: actionText,
            class: action === 'pause' ? 'btn-warning' : 'btn-success',
            onClick: async (modal, close) => {
                try {
                    await update(ref(database, 'campaigns/' + id), { status: newStatus });
                    showNotification(`Campaign ${actionText}d!`, 'success');
                    close();
                    loadCampaigns(); // Refresh list
                } catch (error) {
                    showNotification('Failed to update campaign.', 'error');
                }
            }
        }
    ]);
}

// ==========================================
// BILLING ENGINE
// ==========================================

function startBillingEngine() {
    if (billingInterval) clearInterval(billingInterval);
    // Run every 60 seconds
    billingInterval = setInterval(processBilling, 60000);
}

function stopBillingEngine() {
    if (billingInterval) {
        clearInterval(billingInterval);
        billingInterval = null;
    }
}

function updateLiveFeed(status, message, amount) {
    liveFeedData.push({ status, message, amount, timestamp: Date.now() });
    
    const feedElement = document.getElementById('live-billing-feed');
    if (feedElement) {
        const item = document.createElement('div');
        item.className = `feed-item feed-${status.toLowerCase().replace(/\s+/g, '-')}`;
        item.innerHTML = `
            <span class="feed-time">${new Date().toLocaleTimeString()}</span>
            <span class="feed-status">${status}</span>
            <span class="feed-message">${message}</span>
            ${amount !== 0 ? `<span class="feed-amount">${formatCurrency(amount)}</span>` : ''}
        `;
        feedElement.prepend(item);
    }
    
    const totalElement = document.getElementById('total-billed-session');
    if (totalElement) {
        totalElement.textContent = formatCurrency(totalBilledThisSession);
    }
}

async function processBilling() {
    if (isBillingInProgress) {
        console.log('[Billing Debug] Billing already in progress, skipping cycle.');
        return;
    }

    // STEP 1 — AUTHENTICATION
    const user = auth.currentUser;
    if (!user) {
        console.log('[Billing Debug] No authenticated user. Billing stopped.');
        stopBillingEngine();
        return;
    }

    isBillingInProgress = true;
    console.log(`[Billing Debug] User UID: ${user.uid}`);

    try {
        // STEP 2 — READ THE WALLET BALANCE
        const balanceRef = ref(database, 'users/' + user.uid + '/balance');
        const balanceSnap = await get(balanceRef);
        
        let currentBalance;
        const balanceVal = balanceSnap.val();
        
        if (balanceVal === null || balanceVal === undefined) {
            console.log('[Billing Debug] Wallet balance is null/undefined. Skipping billing.');
            updateLiveFeed('Billing skipped - balance could not be confirmed', 'Unable to verify wallet balance. Billing was skipped.', 0);
            return;
        }
        
        const parsedBalance = Number(balanceVal);
        if (isNaN(parsedBalance)) {
            console.log('[Billing Debug] Wallet balance is not a valid number. Skipping billing.');
            updateLiveFeed('Billing skipped - balance could not be confirmed', 'Unable to verify wallet balance. Billing was skipped.', 0);
            return;
        }
        
        currentBalance = parsedBalance;
        console.log(`[Billing Debug] Balance before transaction: ${currentBalance}`);

        // STEP 3 — DETERMINE CAMPAIGNS THAT SHOULD BE BILLED
        const chargePerAd = 0.020;
        let campaignsToCharge = [];
        let actualCharge = 0;
        let pausedCampaigns = [];

        for (const camp of allCampaigns) {
            if (camp.advertiserId !== user.uid) continue;

            const budget = Number(camp.budget) || 0;
            const currentSpent = Number(camp.spent) || 0;
            const remainingBudget = budget - currentSpent;

            if (camp.status === 'active') {
                if (remainingBudget <= 0) {
                    await update(ref(database, 'campaigns/' + camp.id), { status: 'paused' });
                    camp.status = 'paused';
                    console.log(`[Billing Debug] Campaign ${camp.id} paused due to budget exhaustion.`);
                } else {
                    const amountToCharge = Math.min(chargePerAd, remainingBudget);
                    campaignsToCharge.push({ camp, amountToCharge });
                    actualCharge += amountToCharge;
                }
            } else if (camp.status === 'paused' || camp.status === 'pending') {
                pausedCampaigns.push(camp);
            }
        }

        actualCharge = Math.round(actualCharge * 100) / 100; // Fix float precision
        console.log(`[Billing Debug] Actual charge: ${actualCharge}`);

        // STEP 4 — HANDLE INSUFFICIENT FUNDS BEFORE RESUMING ADS
        if (pausedCampaigns.length > 0 && currentBalance > actualCharge) {
            let potentialCharge = actualCharge;
            for (const camp of pausedCampaigns) {
                const budget = Number(camp.budget) || 0;
                const currentSpent = Number(camp.spent) || 0;
                const remainingBudget = budget - currentSpent;
                
                if (remainingBudget > 0) {
                    let amountToCharge = Math.min(chargePerAd, remainingBudget);
                    if (currentBalance >= potentialCharge + amountToCharge) {
                        await update(ref(database, 'campaigns/' + camp.id), { status: 'active' });
                        camp.status = 'active';
                        campaignsToCharge.push({ camp, amountToCharge });
                        actualCharge += amountToCharge;
                        potentialCharge = actualCharge;
                        console.log(`[Billing Debug] Campaign ${camp.id} auto-resumed due to sufficient balance.`);
                    }
                }
            }
            actualCharge = Math.round(actualCharge * 100) / 100;
        }

        if (campaignsToCharge.length === 0) {
            console.log('[Billing Debug] No campaigns to charge.');
            return;
        }

        if (actualCharge <= 0) {
            console.log('[Billing Debug] Actual charge is 0. No billing needed.');
            return;
        }

        // STEP 5 — ATOMIC BALANCE DEDUCTION
        console.log(`[Billing Debug] Wallet path: users/${user.uid}/balance`);
        
        const { committed, snapshot } = await runTransaction(balanceRef, (currBalance) => {
            console.log(`[Billing Debug] Transaction callback balance: ${currBalance}`);
            
            if (currBalance === null || currBalance === undefined) {
                console.log('[Billing Debug] Transaction aborted: balance is null/undefined.');
                return; // abort safely
            }
            
            const balance = Number(currBalance);
            if (isNaN(balance)) {
                console.log('[Billing Debug] Transaction aborted: balance is NaN.');
                return; // abort safely
            }
            
            if (balance < actualCharge) {
                console.log('[Billing Debug] Transaction aborted: insufficient funds.');
                return; // abort because funds are genuinely insufficient
            }
            
            return balance - actualCharge;
        });

        console.log(`[Billing Debug] Transaction committed: ${committed}`);
        console.log(`[Billing Debug] Final transaction snapshot: ${snapshot.val()}`);

        // STEP 6 — TRANSACTION RESULT HANDLING
        if (committed === true) {
            totalBilledThisSession += actualCharge;
            const newBalance = Number(snapshot.val());
            
            console.log(`[Billing Debug] Deduction successful. New balance: ${newBalance}`);
            
            // Update totalSpent atomically
            const totalSpentRef = ref(database, 'users/' + user.uid + '/totalSpent');
            await runTransaction(totalSpentRef, (curr) => {
                return (Number(curr) || 0) + actualCharge;
            });

            // Create transaction record
            const transactionsRef = ref(database, 'transactions');
            const newTransactionRef = push(transactionsRef);
            await set(newTransactionRef, {
                type: 'ad_spending',
                amount: -actualCharge,
                status: 'completed',
                userId: user.uid,
                createdAt: Date.now()
            });

            // Update campaign spent and pause if budget exhausted
            for (const { camp, amountToCharge } of campaignsToCharge) {
                const campRef = ref(database, 'campaigns/' + camp.id);
                const newSpent = (Number(camp.spent) || 0) + amountToCharge;
                const updateData = { spent: newSpent };
                
                const budget = Number(camp.budget) || 0;
                if (newSpent >= budget) {
                    updateData.status = 'paused';
                    camp.status = 'paused';
                } else {
                    camp.status = 'active';
                }
                
                await update(campRef, updateData);
                camp.spent = newSpent;
            }

            updateLiveFeed('Success', `Charged ${formatCurrency(actualCharge)}. New Balance: ${formatCurrency(newBalance)}`, -actualCharge);
            renderCampaigns('all'); // Refresh UI

        } else {
            // committed === false
            const val = snapshot.val();
            
            if (val !== null && val !== undefined) {
                const serverBalance = Number(val);
                if (!isNaN(serverBalance) && serverBalance < actualCharge) {
                    // A. Genuine insufficient funds
                    console.log('[Billing Debug] Pausing active campaigns due to genuine insufficient funds.');
                    for (const { camp } of campaignsToCharge) {
                        await update(ref(database, 'campaigns/' + camp.id), { status: 'paused' });
                        camp.status = 'paused';
                    }
                    updateLiveFeed('Insufficient balance', `Insufficient wallet balance. Required: ${formatCurrency(actualCharge)}, Available: ${formatCurrency(serverBalance)}`, 0);
                    renderCampaigns('all');
                } else {
                    // B. Ambiguous failure
                    console.log('[Billing Debug] Ambiguous transaction failure. Not pausing campaigns.');
                    updateLiveFeed('Billing skipped - balance could not be confirmed', 'Billing transaction did not commit. Campaigns were not paused because the wallet balance could not be confirmed.', 0);
                }
            } else {
                // B. Ambiguous failure - balance is null/undefined
                console.log('[Billing Debug] Ambiguous transaction failure (null/undefined snapshot). Not pausing campaigns.');
                updateLiveFeed('Billing skipped - balance could not be confirmed', 'Billing transaction did not commit. Campaigns were not paused because the wallet balance could not be confirmed.', 0);
            }
        }

    } catch (error) {
        console.error('[Billing Debug] Error during billing process:', error);
        updateLiveFeed('Error', 'An error occurred during billing.', 0);
    } finally {
        isBillingInProgress = false;
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadCampaigns();
        startBillingEngine();
    } else {
        stopBillingEngine();
    }
});
