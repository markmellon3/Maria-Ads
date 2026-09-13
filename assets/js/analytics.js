import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, escapeHtml, calculateCTR } from './helpers.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

async function loadAnalytics(range) {
 const user = auth.currentUser;
 if (!user) return;
 
 // Simplified logic: In a real app, you'd fetch statistics/{campaignId}/{date} for the specific range
 // Here we just sum up the totals from user profile for demonstration of the UI
 try {
  const userSnap = await get(ref(database, 'users/' + user.uid));
  if (userSnap.exists()) {
   const userData = userSnap.val();
   document.getElementById('analytics-impressions').innerText = userData.totalImpressions || 0;
   document.getElementById('analytics-clicks').innerText = userData.totalClicks || 0;
   document.getElementById('analytics-ctr').innerText = calculateCTR(userData.totalClicks || 0, userData.totalImpressions || 0);
   document.getElementById('analytics-spent').innerText = formatCurrency(userData.totalSpent || 0);
  }
  
  // Fetch Campaigns for performance table
  const campaignsRef = ref(database, 'campaigns');
  const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(user.uid));
  const campaignsSnap = await get(userCampaignsQuery);
  
  const tbody = document.getElementById('analytics-tbody');
  tbody.innerHTML = '';
  
  if (campaignsSnap.exists()) {
   const campaigns = Object.values(campaignsSnap.val());
   campaigns.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
                    <td>${escapeHtml(c.name)}</td>
                    <td>${c.impressions || 0}</td>
                    <td>${c.clicks || 0}</td>
                    <td>${calculateCTR(c.clicks || 0, c.impressions || 0)}</td>
                    <td>${formatCurrency(c.spent || 0)}</td>
                `;
    tbody.appendChild(tr);
   });
  } else {
   tbody.innerHTML = '<tr><td colspan="5" class="text-center">No campaign data available.</td></tr>';
  }
  
 } catch (error) {
  console.error("Analytics Error:", error);
 }
}

// Handle date filters
document.addEventListener('DOMContentLoaded', () => {
 const filterBtns = document.querySelectorAll('.filter-btn');
 filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
   filterBtns.forEach(b => b.classList.remove('active'));
   btn.classList.add('active');
   const range = btn.getAttribute('data-range');
   loadAnalytics(range);
  });
 });
});

onAuthStateChanged(auth, (user) => {
 if (user) loadAnalytics('today');
});