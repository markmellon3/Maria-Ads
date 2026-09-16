import { auth, database } from './firebase.js';
import { ref, query, orderByChild, equalTo, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let dashboardUnsubscribers = [];

function unsubscribeAll() {
    dashboardUnsubscribers.forEach(unsub => unsub());
    dashboardUnsubscribers = [];
}

function loadDashboardData() {
    const user = auth.currentUser;
    if (!user) return;

    // Clear previous listeners if any
    unsubscribeAll();

    // 1. Real-time listener for User Stats (Balance & Spent)
    const userRef = ref(database, 'users/' + user.uid);
    const unsubUser = onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
            const userData = snapshot.val();
            document.getElementById('stat-balance').innerText = formatCurrency(userData.balance);
            document.getElementById('stat-spent').innerText = formatCurrency(userData.totalSpent || 0);
        }
    });
    dashboardUnsubscribers.push(unsubUser);

    // 2. Real-time listener for Campaigns (Calculates Clicks/Impressions dynamically)
    const campaignsRef = ref(database, 'campaigns');
    const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(user.uid));
    
    const unsubCampaigns = onValue(userCampaignsQuery, (snapshot) => {
        const tbody = document.getElementById('dashboard-campaigns-tbody');
        
        // Calculate Totals from Campaigns
        let totalImpressions = 0;
        let totalClicks = 0;
        let activeCount = 0;

        if (snapshot.exists()) {
            const campaigns = snapshot.val();
            let html = '';
            
            Object.keys(campaigns).forEach(key => {
                const c = campaigns[key];
                
                // Sum up stats
                totalImpressions += c.impressions || 0;
                totalClicks += c.clicks || 0;
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

        // Update the summary cards with calculated totals
        document.getElementById('stat-impressions').innerText = totalImpressions.toLocaleString();
        document.getElementById('stat-clicks').innerText = totalClicks.toLocaleString();
        
        const activeCampElement = document.getElementById('stat-active-camps');
        if (activeCampElement) activeCampElement.innerText = activeCount;

    }, (error) => {
        console.error("Error fetching campaigns:", error);
        const tbody = document.getElementById('dashboard-campaigns-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error loading data.</td></tr>';
    });
    
    dashboardUnsubscribers.push(unsubCampaigns);
}

// Wait for auth state to be ready before loading data
onAuthStateChanged(auth, (user) => {
    if (user) {
        loadDashboardData();
    } else {
        // Clean up listeners when user logs out
        unsubscribeAll();
    }
});
