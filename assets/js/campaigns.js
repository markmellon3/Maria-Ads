import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo, update, runTransaction, set, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

console.log('Campaigns.js loaded - Safe Billing Engine v2');

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
    if (!tbody) return;
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
    if (!tbody) return;
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
                    loadCampaigns();
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
    // Run immediately on start
    processBilling();
    // Then run every 60 seconds
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
        item.style.padding = '8px';
        item.style.borderBottom = '1px solid #eee';
        item.innerHTML = `
            <span class="feed-time" style="font-size: 12px; color: #666; margin-right: 10px;">${new Date().toLocaleTimeString()}</span>
            <span class="feed-status" style="font-weight: bold; margin-right: 10px;">${status}</span>
            <span class="feed-message">${message}</span>
            ${amount !== 0 ? `<span class="feed-amount" style="float: right; font-weight: bold;">${formatCurrency(amount)}</span>` : ''}
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

    const user = auth.currentUser;
    if (!user) {
        console.log('[Billing Debug] No authenticated user. Billing stopped.');
        stopBillingEngine();
        return;
    }

    isBillingInProgress = true;
    console.log(`[Billing Debug] Billing cycle started for user: ${user.uid}`);

    try {
        const balanceRef = ref(database, 'users/' + user.uid + '/balance');
        const balanceSnap = await get(balanceRef);
        
        let currentBalance;
        const balanceVal = balanceSnap.val();
        
        if (balanceVal === null || balanceVal === undefined) {
            console.log('[Billing Debug] Wallet balance is null/undefined. Skipping billing.');
            updateLiveFeed('Billing skipped', 'Unable to verify wallet balance. Billing was skipped.', 0);
            return;
        }
        
        const parsedBalance = Number(balanceVal);
        if (isNaN(parsedBalance)) {
            console.log('[Billing Debug] Wallet balance is not a valid number. Skipping billing.');
            updateLiveFeed('Billing skipped', 'Unable to verify wallet balance. Billing was skipped.', 0);
            return;
        }
        
        currentBalance = parsedBalance;
        console.log(`[Billing Debug] Balance before transaction: ${currentBalance}`);

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
                    updateLiveFeed('Budget Exhausted', `Campaign ${camp.name} paused due to budget exhaustion.`, 0);
                } else {
                    const amountToCharge = Math.min(chargePerAd, remainingBudget);
                    campaignsToCharge.push({ camp, amountToCharge });
                    actualCharge += amountToCharge;
                }
            } else if (camp.status === 'paused' || camp.status === 'pending') {
                pausedCampaigns.push(camp);
            }
        }

        actualCharge = Math.round(actualCharge * 100) / 100;
        console.log(`[Billing Debug] Calculated charge: ${actualCharge}`);

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
                        updateLiveFeed('Auto-Resumed', `Campaign ${camp.name} resumed due to sufficient balance.`, 0);
                    }
                }
            }
            actualCharge = Math.round(actualCharge * 100) / 100;
        }

        if (campaignsToCharge.length === 0) {
            console.log('[Billing Debug] No campaigns to charge.');
            updateLiveFeed('Idle', 'No active campaigns to bill.', 0);
            return;
        }

        if (actualCharge <= 0) {
            console.log('[Billing Debug] Actual charge is 0. No billing needed.');
            return;
        }

        console.log(`[Billing Debug] Wallet path: users/${user.uid}/balance`);
        
        const { committed, snapshot } = await runTransaction(balanceRef, (currBalance) => {
            console.log(`[Billing Debug] Transaction callback balance: ${currBalance}`);
            
            if (currBalance === null || currBalance === undefined) return;
            const balance = Number(currBalance);
            if (isNaN(balance)) return;
            if (balance < actualCharge) return;
            return balance - actualCharge;
        });

        console.log(`[Billing Debug] Transaction committed: ${committed}`);
        console.log(`[Billing Debug] Final transaction snapshot: ${snapshot.val()}`);

        if (committed === true) {
            totalBilledThisSession += actualCharge;
            const newBalance = Number(snapshot.val());
            
            console.log(`[Billing Debug] Deduction successful. New balance: ${newBalance}`);
            
            const totalSpentRef = ref(database, 'users/' + user.uid + '/totalSpent');
            await runTransaction(totalSpentRef, (curr) => {
                return (Number(curr) || 0) + actualCharge;
            });

            const transactionsRef = ref(database, 'transactions');
            const newTransactionRef = push(transactionsRef);
            await set(newTransactionRef, {
                type: 'ad_spending',
                amount: -actualCharge,
                status: 'completed',
                userId: user.uid,
                createdAt: Date.now()
            });

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

            updateLiveFeed('Success', `Charged for ${campaignsToCharge.length} ad(s). New Balance: ${formatCurrency(newBalance)}`, -actualCharge);
            renderCampaigns('all');

        } else {
            const val = snapshot.val();
            
            if (val !== null && val !== undefined) {
                const serverBalance = Number(val);
                if (!isNaN(serverBalance) && serverBalance < actualCharge) {
                    console.log('[Billing Debug] Pausing active campaigns due to genuine insufficient funds.');
                    for (const { camp } of campaignsToCharge) {
                        await update(ref(database, 'campaigns/' + camp.id), { status: 'paused' });
                        camp.status = 'paused';
                    }
                    updateLiveFeed('Insufficient balance', `Insufficient wallet balance. Required: ${formatCurrency(actualCharge)}, Available: ${formatCurrency(serverBalance)}`, 0);
                    renderCampaigns('all');
                } else {
                    console.log('[Billing Debug] Ambiguous transaction failure. Not pausing campaigns.');
                    updateLiveFeed('Billing skipped', 'Billing transaction did not commit. Campaigns were not paused.', 0);
                }
            } else {
                console.log('[Billing Debug] Ambiguous transaction failure (null/undefined snapshot). Not pausing campaigns.');
                updateLiveFeed('Billing skipped', 'Billing transaction did not commit. Campaigns were not paused.', 0);
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
