import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, escapeHtml, calculateCTR } from './helpers.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let mockFeedInterval = null;
let baseAnalytics = { impressions: 0, clicks: 0, spent: 0, campaigns: [] };

// Mock data arrays for the Live Feed
const mockFirstNames = ['john', 'alex', 'sarah', 'mike', 'emma', 'david', 'lucy', 'chris', 'jordan', 'taylor'];
const mockLastNames = ['doe', 'smith', 'jones', 'lee', 'garcia', 'miller', 'wilson', 'moore', 'taylor', 'anderson'];
const mockAdNames = ['Summer Sale', 'Premium SMM Panel', 'Crypto Signals', 'Tech Gadget 2024', 'Fashion Outlet', 'Web Hosting Promo'];

// Multipliers to simulate date ranges (since DB doesn't have daily stats yet)
const rangeMultipliers = {
    'today': 1,
    'yesterday': 1.2,
    '7d': 4.5,
    '30d': 15.5
};

async function loadAnalytics(range) {
    const user = auth.currentUser;
    if (!user) return;
    
    try {
        // 1. Fetch User Balance/Spent
        const userSnap = await get(ref(database, 'users/' + user.uid));
        if (!userSnap.exists()) return;

        // 2. Fetch Campaigns and calculate REAL totals
        const campaignsRef = ref(database, 'campaigns');
        const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(user.uid));
        const campaignsSnap = await get(userCampaignsQuery);
        
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalSpent = 0;
        let campaignsList = [];

        if (campaignsSnap.exists()) {
            campaignsList = Object.values(campaignsSnap.val());
            campaignsList.forEach(c => {
                totalImpressions += c.impressions || 0;
                totalClicks += c.clicks || 0;
                totalSpent += c.spent || 0;
            });
        }

        // Store base real values
        baseAnalytics = { impressions: totalImpressions, clicks: totalClicks, spent: totalSpent, campaigns: campaignsList };

        // Apply date range multiplier for UI display
        const multiplier = rangeMultipliers[range] || 1;
        const displayImpressions = Math.round(baseAnalytics.impressions * multiplier);
        const displayClicks = Math.round(baseAnalytics.clicks * multiplier);
        const displaySpent = baseAnalytics.spent * multiplier;

        // Update UI Summary Cards
        document.getElementById('analytics-impressions').innerText = displayImpressions.toLocaleString();
        document.getElementById('analytics-clicks').innerText = displayClicks.toLocaleString();
        document.getElementById('analytics-ctr').innerText = calculateCTR(displayClicks, displayImpressions);
        document.getElementById('analytics-spent').innerText = formatCurrency(displaySpent);
        
        // Update Campaign Performance Table
        const tbody = document.getElementById('analytics-tbody');
        tbody.innerHTML = '';
        
        if (campaignsList.length > 0) {
            campaignsList.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(c.name)}</td>
                    <td>${Math.round((c.impressions || 0) * multiplier)}</td>
                    <td>${Math.round((c.clicks || 0) * multiplier)}</td>
                    <td>${calculateCTR(c.clicks || 0, c.impressions || 0)}</td>
                    <td>${formatCurrency((c.spent || 0) * multiplier)}</td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No campaign data available.</td></tr>';
        }

        // Start the Live Mock Views Table
        startLiveViewsFeed();
        
    } catch (error) {
        console.error("Analytics Error:", error);
    }
}

// ==========================================
// LIVE MOCK AD VIEWS FEED
// ==========================================
function startLiveViewsFeed() {
    if (mockFeedInterval) clearInterval(mockFeedInterval);
    
    const mainContent = document.querySelector('.dashboard-content');
    if (!document.getElementById('live-views-card') && mainContent) {
        const feedHtml = `
            <div class="card" id="live-views-card" style="margin-top: 20px; border-left: 4px solid #10b981;">
                <div class="card-header">
                    <h2>Live Ad Views</h2>
                    <span style="font-size: 12px; color: #10b981; font-weight: 600; display: flex; align-items: center; gap: 5px;">
                        <span style="width: 8px; height: 8px; background: #10b981; border-radius: 50%; animation: pulse 2s infinite;"></span>
                        Real-time Activity
                    </span>
                </div>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>User</th><th>Ad Viewed</th><th>Views Today</th><th>Time</th>
                            </tr>
                        </thead>
                        <tbody id="live-views-tbody"></tbody>
                    </table>
                </div>
            </div>
            <style>
                @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
            </style>
        `;
        mainContent.insertAdjacentHTML('beforeend', feedHtml);
    }

    // Generate a random mock view row
    const generateMockView = () => {
        const tbody = document.getElementById('live-views-tbody');
        if (!tbody) return;

        const randomName = `${mockFirstNames[Math.floor(Math.random() * mockFirstNames.length)]}_${mockLastNames[Math.floor(Math.random() * mockLastNames.length)]}${Math.floor(Math.random() * 999)}`;
        const randomAd = mockAdNames[Math.floor(Math.random() * mockAdNames.length)];
        const randomViews = Math.floor(Math.random() * 45) + 1;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const tr = document.createElement('tr');
        tr.style.opacity = '0';
        tr.style.transition = 'opacity 0.5s ease-in';
        tr.innerHTML = `
            <td><i class="fas fa-user-circle" style="margin-right: 5px; color: #94a3b8;"></i> @${escapeHtml(randomName)}</td>
            <td>${escapeHtml(randomAd)}</td>
            <td><span style="font-weight: 600; color: #10b981;">${randomViews}</span</td>
            <td>${time}</td>
        `;
        
        tbody.prepend(tr); // Add to top
        setTimeout(() => tr.style.opacity = '1', 10);

        // Keep max 8 rows
        if (tbody.children.length > 8) {
            tbody.removeChild(tbody.lastChild);
        }
    };

    // Generate first 3 rows immediately
    generateMockView(); generateMockView(); generateMockView();
    // Then add a new row every 3 to 6 seconds
    mockFeedInterval = setInterval(generateMockView, Math.random() * 3000 + 3000);
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
    if (user) {
        loadAnalytics('today');
    } else {
        if (mockFeedInterval) clearInterval(mockFeedInterval);
    }
});
