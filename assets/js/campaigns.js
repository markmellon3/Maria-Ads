import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo, update, runTransaction, push, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let allCampaigns = [];
let billingInterval = null;
let liveFeedData = [];

// ==========================================
// 1. LOAD & RENDER CAMPAIGNS
// ==========================================
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
            injectLiveFeedUI(); // Inject the UI for the deductions table
            startBillingEngine(); // Start the 1-minute deduction timer
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

// ==========================================
// 2. ACTIVATE / PAUSE LOGIC & WARNING
// ==========================================
function handleCampaignAction(id, action) {
    const newStatus = action === 'pause' ? 'paused' : 'active';
    const actionText = action === 'pause' ? 'Pause' : 'Activate';

    let modalContent = `<p>Are you sure you want to ${actionText} this campaign?</p>`;
    
    // Add billing warning if activating
    if (action === 'activate') {
        modalContent += `
            <div style="padding: 10px; background: #fef3c7; border-left: 4px solid #f59e0b; margin-top: 15px; border-radius: 4px;">
                <strong>Notice:</strong> Activating this ad means your account balance will be automatically deducted <strong>$0.020 per minute</strong> for each active ad.
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
// 3. LIVE BILLING ENGINE (Core Logic)
// ==========================================
function startBillingEngine() {
    // Clear any existing interval to prevent duplicates
    if (billingInterval) clearInterval(billingInterval);
    
    // Run immediately, then every 60 seconds (60000 ms)
    processBilling();
    billingInterval = setInterval(processBilling, 60000); 
}

async function processBilling() {
    const user = auth.currentUser;
    if (!user) return;

    const activeCampaigns = allCampaigns.filter(c => c.status === 'active');
    if (activeCampaigns.length === 0) return; // No active ads, no deduction

    const chargePerAd = 0.020;
    const totalCharge = chargePerAd * activeCampaigns.length;

    const userBalanceRef = ref(database, 'users/' + user.uid + '/balance');
    
    try {
        // Atomic Transaction to deduct balance safely
        const { committed, snapshot } = await runTransaction(userBalanceRef, (currentBalance) => {
            const balance = currentBalance || 0;
            if (balance >= totalCharge) {
                return balance - totalCharge; // Deduct
            } else {
                return; // Abort transaction (insufficient funds)
            }
        });

        if (committed) {
            // Success: Balance was deducted. Now update stats and log feed.
            const newBalance = snapshot.val();
            
            // 1. Update totalSpent atomically
            await runTransaction(ref(database, 'users/' + user.uid + '/totalSpent'), (curr) => (curr || 0) + totalCharge);

            // 2. Update each campaign's 'spent' field
            for (const camp of activeCampaigns) {
                await runTransaction(ref(database, 'campaigns/' + camp.id + '/spent'), (curr) => (curr || 0) + chargePerAd);
            }

            // 3. Log to database transactions node
            const txRef = push(ref(database, 'transactions'));
            await set(txRef, {
                userId: user.uid,
                type: 'ad_spending',
                amount: -totalCharge,
                status: 'completed',
                description: `Auto-deduction for ${activeCampaigns.length} active ad(s)`,
                createdAt: Date.now()
            });

            // 4. Update local UI live feed
            const feedItem = {
                time: new Date().toLocaleTimeString(),
                campaigns: activeCampaigns.length,
                amount: totalCharge,
                status: 'Success'
            };
            liveFeedData.unshift(feedItem);
            if (liveFeedData.length > 10) liveFeedData.pop(); // Keep max 10 records
            renderLiveFeed();

            // 5. Update local allCampaigns spent value so UI doesn't need full reload
            activeCampaigns.forEach(camp => {
                const localCamp = allCampaigns.find(c => c.id === camp.id);
                if (localCamp) localCamp.spent = (localCamp.spent || 0) + chargePerAd;
            });

        } else {
            // Aborted: Insufficient Balance
            showNotification('Insufficient Balance: Please add more funds to keep your active ads running. Pausing active ads to prevent negative balance.', 'error', 8000);
            
            // Auto-pause all active campaigns to stop bleeding money
            for (const camp of activeCampaigns) {
                await update(ref(database, 'campaigns/' + camp.id), { status: 'paused' });
            }
            
            // Add failed entry to feed
            liveFeedData.unshift({
                time: new Date().toLocaleTimeString(),
                campaigns: activeCampaigns.length,
                amount: totalCharge,
                status: 'Failed (Insufficient Balance)'
            });
            renderLiveFeed();

            // Reload campaigns to reflect paused status
            loadCampaigns(); 
        }
    } catch (error) {
        console.error("Billing Engine Error:", error);
    }
}

// ==========================================
// 4. LIVE FEED UI
// ==========================================
function injectLiveFeedUI() {
    if (document.getElementById('billing-feed-card')) return; // Don't inject twice

    const mainContent = document.querySelector('.dashboard-content');
    if (!mainContent) return;

    const feedHtml = `
        <div class="card" id="billing-feed-card" style="margin-top: 20px;">
            <div class="card-header">
                <h2>Live Billing Feed</h2>
                <span style="font-size: 12px; color: #64748b; font-weight: 500;">Deducting $0.020/min per active ad</span>
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
    
    // Insert before the campaigns table card
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

    if (liveFeedData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No deductions yet.</td></tr>';
        return;
    }

    tbody.innerHTML = liveFeedData.map(item => `
        <tr>
            <td>${escapeHtml(item.time)}</td>
            <td>${item.campaigns}</td>
            <td style="color: #ef4444; font-weight: 600;">-${formatCurrency(item.amount)}</td>
            <td><span style="color: ${item.status === 'Success' ? '#10b981' : '#ef4444'}; font-weight: 600;">${escapeHtml(item.status)}</span></td>
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
        // Clean up interval on logout
        if (billingInterval) clearInterval(billingInterval);
        billingInterval = null;
    }
});
