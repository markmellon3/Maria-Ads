import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo, update, runTransaction, push, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let allCampaigns = [];
let billingInterval = null;
let liveFeedData = [];
let totalBilledThisSession = 0;

// ==========================================
// 1. LOAD & RENDER CAMPAIGNS
// ==========================================
async function loadCampaigns() {
    const user = auth.currentUser;
    if (!user) return;

    const tbody = document.getElementById('campaigns-tbody');
    if (!tbody) {
        console.error("Campaigns table body not found in DOM.");
        return;
    }
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading campaigns...</td></tr>';

    try {
        const campaignsRef = ref(database, 'campaigns');
        const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(user.uid));
        const snapshot = await get(userCampaignsQuery);

        if (snapshot.exists()) {
            allCampaigns = Object.entries(snapshot.val()).map(([id, data]) => ({ id, ...data }));
            renderCampaigns('all');
            setupFilters();
            injectLiveFeedUI();
            startBillingEngine();
        } else {
            allCampaigns = [];
            tbody.innerHTML = '<tr><td colspan="10" class="text-center">No campaigns found. <a href="create-ad.html">Create one!</a></td></tr>';
        }
    } catch (error) {
        console.error("Error fetching campaigns:", error);
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error loading campaigns: ${error.message}</td></tr>`;
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

// ==========================================
// 2. ACTIVATE / PAUSE LOGIC & WARNING
// ==========================================
function handleCampaignAction(id, action) {
    const newStatus = action === 'pause' ? 'paused' : 'active';
    const actionText = action === 'pause' ? 'Pause' : 'Activate';

    let modalContent = `<p>Are you sure you want to ${actionText} this campaign?</p>`;
    
    if (action === 'activate') {
        modalContent += `
            <div style="padding: 10px; background: #fef3c7; border-left: 4px solid #f59e0b; margin-top: 15px; border-radius: 4px;">
                <strong>Notice:</strong> Activating this ad means your account balance will be automatically deducted <strong>$0.020 per minute</strong> for each active ad, until its budget is exhausted.
            </div>
        `;
    }

    showModal(`Confirm ${actionText}`, modalContent, [
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
                } catch (error) {
                    console.error("Update Error:", error);
                    showNotification(`Failed to update campaign: ${error.message}`, 'error');
                    return;
                }

                showNotification(`Campaign ${actionText}d!`, 'success');
                close();

                try {
                    await loadCampaigns();
                } catch (e) {
                    console.error("Reload error after campaign update:", e);
                }
            }
        }
    ]);
}

// ==========================================
// 3. LIVE BILLING ENGINE (Core Logic)
// ==========================================
function startBillingEngine() {
    if (billingInterval) clearInterval(billingInterval);
    processBilling();
    billingInterval = setInterval(processBilling, 60000); // Run every 60 seconds
}

async function processBilling() {
    const user = auth.currentUser;
    if (!user) return;

    // 0. Check current balance first to allow auto-resume
    const balanceSnap = await get(ref(database, 'users/' + user.uid + '/balance'));
    const currentBalance = Number(balanceSnap.val()) || 0;
    let resumedCount = 0;

    // Auto-Resume paused ads if user has funds and the ad hasn't hit its budget limit
    if (currentBalance > 0) {
        for (let c of allCampaigns) {
            if (c.status === 'paused') {
                const currentSpent = Number(c.spent) || 0;
                const budget = Number(c.budget) || 0;
                if (currentSpent < budget) {
                    try {
                        await update(ref(database, 'campaigns/' + c.id), { status: 'active' });
                        c.status = 'active'; // Update local state
                        resumedCount++;
                    } catch (err) {
                        console.error("Failed to auto-resume campaign:", err);
                        showNotification(`Resume Error: ${err.message}`, 'error', 5000);
                    }
                }
            }
        }
    }

    if (resumedCount > 0) {
        showNotification(`${resumedCount} paused campaign(s) automatically resumed.`, 'success', 5000);
        renderCampaigns('all'); // Re-render UI to show active status
    }

    // Filter for ads that are currently active to bill them
    const activeCampaigns = allCampaigns.filter(c => c.status === 'active');
    if (activeCampaigns.length === 0) return;

    const chargePerAd = 0.020;
    let actualCharge = 0;
    let campaignsToCharge = [];
    let pausedDueToBudgetCount = 0;

    // 1. Evaluate each campaign individually for budget limits
    for (let c of activeCampaigns) {
        const currentSpent = Number(c.spent) || 0;
        const budget = Number(c.budget) || 0;

        if (currentSpent >= budget) {
            try {
                await update(ref(database, 'campaigns/' + c.id), { status: 'paused' });
                c.status = 'paused';
                pausedDueToBudgetCount++;
            } catch (err) {
                console.error("Failed to auto-pause budget-exhausted campaign:", err);
                showNotification(`Pause Error: ${err.message}`, 'error', 5000);
            }
            continue;
        }

        const amountToCharge = Math.min(chargePerAd, budget - currentSpent);
        campaignsToCharge.push({
            id: c.id,
            amount: amountToCharge,
            willPauseAfter: (currentSpent + amountToCharge) >= budget
        });
        actualCharge += amountToCharge;
    }

    if (pausedDueToBudgetCount > 0) {
        showNotification(`${pausedDueToBudgetCount} campaign(s) reached their budget and were paused.`, 'warning', 5000);
        renderCampaigns('all');
    }

    if (actualCharge === 0) return;

    const userBalanceRef = ref(database, 'users/' + user.uid + '/balance');
    
    try {
        // 2. Check Balance & Deduct Atomically
        const { committed, snapshot } = await runTransaction(userBalanceRef, (currBalance) => {
            const balance = Number(currBalance) || 0;
            if (balance >= actualCharge) {
                return balance - actualCharge;
            } else {
                return; // Abort (insufficient funds)
            }
        });

        if (committed) {
            // 3. Balance deducted successfully. Update campaigns and logs.
            await runTransaction(ref(database, 'users/' + user.uid + '/totalSpent'), (curr) => {
                return (Number(curr) || 0) + actualCharge;
            });

            let budgetPausedThisCycle = 0;

            for (let camp of campaignsToCharge) {
                await runTransaction(ref(database, 'campaigns/' + camp.id + '/spent'), (curr) => {
                    return (Number(curr) || 0) + camp.amount;
                });
                
                const localCamp = allCampaigns.find(c => c.id === camp.id);
                if (localCamp) {
                    localCamp.spent = (Number(localCamp.spent) || 0) + camp.amount;
                }

                if (camp.willPauseAfter) {
                    await update(ref(database, 'campaigns/' + camp.id), { status: 'paused' });
                    if (localCamp) localCamp.status = 'paused';
                    budgetPausedThisCycle++;
                }
            }

            if (budgetPausedThisCycle > 0) {
                showNotification(`${budgetPausedThisCycle} campaign(s) reached their budget limit and were paused.`, 'warning', 5000);
                renderCampaigns('all');
            }

            // Log Transaction
            const txRef = push(ref(database, 'transactions'));
            await set(txRef, {
                userId: user.uid,
                type: 'ad_spending',
                amount: -actualCharge,
                status: 'completed',
                description: `Auto-deduction for ${campaignsToCharge.length} active ad(s)`,
                createdAt: Date.now()
            });

            // Update UI Feed
            totalBilledThisSession += actualCharge;
            liveFeedData.unshift({
                time: new Date().toLocaleTimeString(),
                campaigns: campaignsToCharge.length,
                amount: actualCharge,
                status: 'Success'
            });
            if (liveFeedData.length > 10) liveFeedData.pop();
            renderLiveFeed();

        } else {
            // Aborted: Insufficient Balance - DISPLAY EXACT BUG ON SCREEN
            const errorMsg = `Insufficient Balance! Charge: $${actualCharge.toFixed(2)}, Available: $${currentBalance.toFixed(2)}`;
            console.error("[Billing Debug]", errorMsg);
            showNotification(errorMsg, 'error', 8000);
            
            for (const camp of activeCampaigns) {
                await update(ref(database, 'campaigns/' + camp.id), { status: 'paused' });
                const localCamp = allCampaigns.find(c => c.id === camp.id);
                if (localCamp) localCamp.status = 'paused';
            }
            
            liveFeedData.unshift({
                time: new Date().toLocaleTimeString(),
                campaigns: activeCampaigns.length,
                amount: actualCharge,
                status: errorMsg // Show exact error in table
            });
            renderLiveFeed();
            renderCampaigns('all'); 
        }
    } catch (error) {
        // CATCH BLOCK: DISPLAY EXACT FIREBASE ERROR ON SCREEN
        console.error("Billing Engine Error:", error);
        const errorMsg = `Billing Crash: ${error.message}`;
        showNotification(errorMsg, 'error', 0); // 0 duration keeps it on screen until clicked
        
        liveFeedData.unshift({
            time: new Date().toLocaleTimeString(),
            campaigns: activeCampaigns.length,
            amount: actualCharge,
            status: errorMsg // Show exact crash in table
        });
        renderLiveFeed();
    }
}

// ==========================================
// 4. LIVE FEED UI
// ==========================================
function injectLiveFeedUI() {
    if (document.getElementById('billing-feed-card')) return;

    const mainContent = document.querySelector('.dashboard-content');
    if (!mainContent) return;

    const feedHtml = `
        <div class="card" id="billing-feed-card" style="margin-top: 20px;">
            <div class="card-header" style="flex-direction: column; align-items: flex-start; gap: 10px;">
                <div style="display: flex; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: 10px;">
                    <h2>Live Billing Feed</h2>
                    <div style="display: flex; flex-direction: column; align-items: flex-end;">
                        <span style="font-size: 12px; color: #64748b; font-weight: 500;">Deducting $0.020/min per active ad</span>
                        <span style="font-size: 16px; color: #ef4444; font-weight: 700;">Total Billed: $<span id="total-billed-amount">0.00</span></span>
                    </div>
                </div>
            </div>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Time</th><th>Active Ads Charged</th><th>Amount Deducted</th><th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="billing-feed-tbody">
                        <tr><td colspan="4" class="text-center">Waiting for first deduction cycle...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    const campaignsCard = document.querySelector('.card');
    if (campaignsCard) {
        campaignsCard.insertAdjacentHTML('beforebegin', feedHtml);
    } else {
        mainContent.insertAdjacentHTML('beforeend', feedHtml);
    }
}

function renderLiveFeed() {
    const tbody = document.getElementById('billing-feed-tbody');
    if (!tbody) return;

    // Update Total Billed Amount
    const totalEl = document.getElementById('total-billed-amount');
    if (totalEl) {
        totalEl.innerText = totalBilledThisSession.toFixed(2);
    }

    if (liveFeedData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No deductions yet.</td></tr>';
        return;
    }

    tbody.innerHTML = liveFeedData.map(item => `
        <tr>
            <td>${escapeHtml(item.time)}</td>
            <td>${item.campaigns}</td>
            <td style="color: #ef4444; font-weight: 600;">-${formatCurrency(item.amount)}</td>
            <td><span style="color: ${item.status === 'Success' ? '#10b981' : '#ef4444'}; font-weight: 600; font-size: 12px;">${escapeHtml(item.status)}</span></td>
        </tr>
    `).join('');
}

// ==========================================
// 5. AUTH STATE & CLEANUP
// ==========================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        loadCampaigns();
    } else {
        if (billingInterval) clearInterval(billingInterval);
        billingInterval = null;
    }
});
