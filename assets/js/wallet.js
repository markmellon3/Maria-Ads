import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

async function loadWalletData() {
 const user = auth.currentUser;
 if (!user) return;
 
 try {
  // Fetch Balance
  const userSnap = await get(ref(database, 'users/' + user.uid));
  if (userSnap.exists()) {
   const userData = userSnap.val();
   document.getElementById('wallet-balance').innerText = formatCurrency(userData.balance);
   document.getElementById('wallet-deposited').innerText = formatCurrency(userData.totalDeposited || 0);
   document.getElementById('wallet-spent').innerText = formatCurrency(userData.totalSpent || 0);
  }
  
  // Fetch Transactions
  const transactionsRef = ref(database, 'transactions');
  const userTxQuery = query(transactionsRef, orderByChild('userId'), equalTo(user.uid));
  const txSnap = await get(userTxQuery);
  
  const tbody = document.getElementById('wallet-transactions-tbody');
  tbody.innerHTML = '';
  
  if (txSnap.exists()) {
   const transactions = Object.values(txSnap.val()).sort((a, b) => b.date - a.date);
   transactions.forEach(tx => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
                    <td>${formatDate(tx.date)}</td>
                    <td>${escapeHtml(tx.type)}</td>
                    <td>${tx.amount >= 0 ? '+' : ''}${formatCurrency(tx.amount)}</td>
                    <td><span class="status-badge status-${tx.status}">${tx.status}</span></td>
                    <td>${escapeHtml(tx.reference || 'N/A')}</td>
                `;
    tbody.appendChild(tr);
   });
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
                <p>To add funds to your account, please use the secure payment portal.</p>
                <p><strong>Note:</strong> Direct payment gateway integration (e.g., Stripe) is required to process this automatically. Please contact support to manually add funds for now.</p>
            `, [
    { label: 'Close', class: 'btn-secondary', onClick: (modal, close) => close() }
   ]);
  });
 }
});

onAuthStateChanged(auth, (user) => {
 if (user) loadWalletData();
});