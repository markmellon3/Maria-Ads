import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let allCampaigns = [];

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

onAuthStateChanged(auth, (user) => {
    if (user) loadCampaigns();
});