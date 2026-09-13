import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';

async function loadDashboardData() {
 const user = auth.currentUser;
 if (!user) return;
 
 try {
  // Fetch User Stats
  const userSnap = await get(ref(database, 'users/' + user.uid));
  if (userSnap.exists()) {
   const userData = userSnap.val();
   document.getElementById('stat-balance').innerText = formatCurrency(userData.balance);
   document.getElementById('stat-spent').innerText = formatCurrency(userData.totalSpent);
   document.getElementById('stat-impressions').innerText = userData.totalImpressions || 0;
   document.getElementById('stat-clicks').innerText = userData.totalClicks || 0;
  }
  
  // Fetch Campaigns
  const campaignsRef = ref(database, 'campaigns');
  const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(user.uid));
  const campaignsSnap = await get(userCampaignsQuery);
  
  const tbody = document.getElementById('dashboard-campaigns-tbody');
  tbody.innerHTML = '';
  
  if (campaignsSnap.exists()) {
   const campaigns = campaignsSnap.val();
   let activeCount = 0;
   let html = '';
   
   Object.keys(campaigns).forEach(key => {
    const c = campaigns[key];
    if (c.status === 'active') activeCount++;
    
    html += `
                    <tr>
                        <td>${escapeHtml(c.name)}</td>
                        <td><span class="status-badge status-${c.status}">${c.status}</span></td>
                        <td>${formatCurrency(c.budget)}</td>
                        <td>${formatCurrency(c.spent)}</td>
                        <td>${c.impressions || 0}</td>
                        <td>${c.clicks || 0}</td>
                        <td>${calculateCTR(c.clicks || 0, c.impressions || 0)}</td>
                        <td>
                            <a href="campaigns.html" class="btn btn-sm btn-secondary">View</a>
                        </td>
                    </tr>
                `;
   });
   
   tbody.innerHTML = html;
  } else {
   tbody.innerHTML = '<tr><td colspan="8" class="text-center">No campaigns found. Create one!</td></tr>';
  }
  
 } catch (error) {
  console.error("Error loading dashboard data:", error);
  const tbody = document.getElementById('dashboard-campaigns-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error loading data.</td></tr>';
 }
}

// Wait for auth state to be ready before loading data
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
onAuthStateChanged(auth, (user) => {
 if (user) {
  loadDashboardData();
 }
});