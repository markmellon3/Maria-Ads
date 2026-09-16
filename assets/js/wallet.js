import { auth, database } from './firebase.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

async function loadWalletData() {
    const user = auth.currentUser;
    if (!user) return;
    
    try {
        // 1. Fetch Balance & User Stats
        const userSnap = await get(ref(database, 'users/' + user.uid));
        if (userSnap.exists()) {
            const userData = userSnap.val();
            // Use Number() to ensure strings from DB are converted to numbers
            document.getElementById('wallet-balance').innerText = formatCurrency(Number(userData.balance) || 0);
            document.getElementById('wallet-deposited').innerText = formatCurrency(Number(userData.totalDeposited) || 0);
            document.getElementById('wallet-spent').innerText = formatCurrency(Number(userData.totalSpent) || 0);
        }
        
        // 2. Fetch Transactions (Fetch all and filter locally to avoid Firebase index errors)
        const txSnap = await get(ref(database, 'transactions'));
        const tbody = document.getElementById('wallet-transactions-tbody');
        
        if (txSnap.exists()) {
            const allTx = txSnap.val();
            // Filter transactions belonging to this user
            const userTx = Object.values(allTx).filter(tx => tx.userId === user.uid);
            
            // Sort by createdAt descending (newest first)
            userTx.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            
            if (userTx.length > 0) {
                tbody.innerHTML = '';
                userTx.forEach(tx => {
                    const tr = document.createElement('tr');
                    const amount = Number(tx.amount) || 0;
                    tr.innerHTML = `
                        <td>${formatDate(tx.createdAt || tx.date)}</td>
                        <td>${escapeHtml(tx.type)}</td>
                        <td style="color: ${amount >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                            ${amount >= 0 ? '+' : ''}${formatCurrency(amount)}
                        </td>
                        <td><span class="status-badge status-${tx.status}">${tx.status}</span></td>
                        <td>${escapeHtml(tx.description || tx.reference || 'N/A')}</td>
                    `;
                    tbody.appendChild(tr);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center">No transactions yet.</td></tr>';
            }
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No transactions yet.</td></tr>';
        }
        
    } catch (error) {
        console.error("Wallet Error:", error);
        showNotification('Failed to load wallet data.', 'error');
    }
}

// Handle Add Funds Button
document.addEventListener('DOMContentLoaded', () => {
    const addFundsBtn = document.getElementById('add-funds-btn');
    if (addFundsBtn) {
        addFundsBtn.addEventListener('click', () => {
            showModal('Add Funds', `
                <div style="text-align: center;">
                    <p style="margin-bottom: 20px;">To add funds to your account, please use the secure payment portal.</p>
                    <p style="font-size: 14px; color: #64748b;"><strong>Note:</strong> Direct payment gateway integration (e.g., Stripe) is required to process this automatically. Please contact support to manually add funds for now.</p>
                </div>
            `, [
                { label: 'Close', class: 'btn-secondary', onClick: (modal, close) => close() }
            ]);
        });
    }
});

onAuthStateChanged(auth, (user) => {
    if (user) loadWalletData();
});
