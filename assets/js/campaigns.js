import { auth, database } from './firebase.js';
import { ref, get, query, orderByChild, equalTo, update, remove, push, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, formatDate, escapeHtml, calculateCTR } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let allCampaigns = [];
let filteredCampaigns = [];
let currentPage = 1;
const itemsPerPage = 10;

// ==========================================
// INITIALIZATION
// ==========================================

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadCampaigns();
        setupEventListeners();
    } else {
        window.location.href = 'login.html';
    }
});

function setupEventListeners() {
    document.getElementById('search-input').addEventListener('input', applyFilters);
    document.getElementById('status-filter').addEventListener('change', applyFilters);
    document.getElementById('objective-filter').addEventListener('change', applyFilters);
    document.getElementById('type-filter').addEventListener('change', applyFilters);
    document.getElementById('sort-filter').addEventListener('change', applyFilters);
    document.getElementById('refresh-btn').addEventListener('click', loadCampaigns);
}

// ==========================================
// DATA LOADING
// ==========================================

async function loadCampaigns() {
    const user = auth.currentUser;
    if (!user) return;

    const tbody = document.getElementById('campaigns-tbody');
    const cardsContainer = document.getElementById('campaigns-cards-container');
    
    tbody.innerHTML = `<tr><td colspan="10" class="text-center">Loading campaigns...</td></tr>`;
    cardsContainer.innerHTML = `<div class="text-center p-2">Loading campaigns...</div>`;

    try {
        console.log('Fetching campaigns for user:', user.uid);
        const campaignsRef = ref(database, 'campaigns');
        
        // Try indexed query first
        const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(user.uid));
        const snapshot = await get(userCampaignsQuery);

        console.log('Indexed query exists:', snapshot.exists());

        if (snapshot.exists()) {
            allCampaigns = Object.entries(snapshot.val()).map(([id, data]) => ({ id, ...data }));
        } else {
            // Fallback: Fetch all campaigns and filter client-side
            // This fixes issues where Firebase indexing rules are not set up
            console.log('Indexed query failed or empty. Falling back to fetch all...');
            const allSnapshot = await get(campaignsRef);
            if (allSnapshot.exists()) {
                const allData = allSnapshot.val();
                allCampaigns = Object.entries(allData)
                    .map(([id, data]) => ({ id, ...data }))
                    .filter(c => c.advertiserId === user.uid || c.userId === user.uid);
                console.log('Fallback found campaigns:', allCampaigns.length);
            } else {
                allCampaigns = [];
            }
        }

        if (allCampaigns.length > 0) {
            renderStats(allCampaigns);
            applyFilters();
        } else {
            allCampaigns = [];
            renderStats(allCampaigns);
            showEmptyState();
        }
    } catch (error) {
        console.error("Error fetching campaigns:", error);
        tbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error loading campaigns. Check console.</td></tr>`;
        cardsContainer.innerHTML = `<div class="text-center text-danger p-2">Error loading campaigns.</div>`;
        showNotification('Failed to load campaigns.', 'error');
    }
}

function renderStats(camps) {
    document.getElementById('stat-total').textContent = camps.length;
    document.getElementById('stat-active').textContent = camps.filter(c => c.status === 'active').length;
    document.getElementById('stat-paused').textContent = camps.filter(c => c.status === 'paused').length;
    
    const totalSpent = camps.reduce((sum, c) => sum + (Number(c.spent) || 0), 0);
    document.getElementById('stat-spent').textContent = formatCurrency(totalSpent);
}

// ==========================================
// FILTERING & SORTING
// ==========================================

function applyFilters() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const status = document.getElementById('status-filter').value;
    const objective = document.getElementById('objective-filter').value;
    const type = document.getElementById('type-filter').value;
    const sortBy = document.getElementById('sort-filter').value;

    filteredCampaigns = allCampaigns.filter(c => {
        // Search
        const matchesSearch = !searchTerm || 
            (c.name && c.name.toLowerCase().includes(searchTerm)) ||
            (c.objective && c.objective.toLowerCase().includes(searchTerm)) ||
            (c.destinationUrl && c.destinationUrl.toLowerCase().includes(searchTerm)) ||
            (c.id && c.id.toLowerCase().includes(searchTerm));

        // Filters
        const matchesStatus = status === 'all' || c.status === status;
        const matchesObjective = objective === 'all' || c.objective === objective;
        const matchesType = type === 'all' || c.adType === type;

        return matchesSearch && matchesStatus && matchesObjective && matchesType;
    });

    // Sorting
    switch(sortBy) {
        case 'oldest': filteredCampaigns.sort((a,b) => (a.createdAt||0) - (b.createdAt||0)); break;
        case 'name-az': filteredCampaigns.sort((a,b) => (a.name||'').localeCompare(b.name||'')); break;
        case 'name-za': filteredCampaigns.sort((a,b) => (b.name||'').localeCompare(a.name||'')); break;
        case 'impressions': filteredCampaigns.sort((a,b) => (b.impressions||0) - (a.impressions||0)); break;
        case 'clicks': filteredCampaigns.sort((a,b) => (b.clicks||0) - (a.clicks||0)); break;
        case 'spent': filteredCampaigns.sort((a,b) => (b.spent||0) - (a.spent||0)); break;
        default: filteredCampaigns.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)); // newest
    }

    currentPage = 1;
    renderCampaigns();
}

// ==========================================
// RENDERING
// ==========================================

function renderCampaigns() {
    const totalItems = filteredCampaigns.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedItems = filteredCampaigns.slice(startIndex, startIndex + itemsPerPage);

    const tbody = document.getElementById('campaigns-tbody');
    const cardsContainer = document.getElementById('campaigns-cards-container');

    if (totalItems === 0) {
        showEmptyState();
        renderPagination(0);
        return;
    }

    // Desktop Table
    tbody.innerHTML = paginatedItems.map(c => {
        const impressions = c.impressions || 0;
        const clicks = c.clicks || 0;
        const ctr = calculateCTR(clicks, impressions);
        const spent = formatCurrency(c.spent || 0);
        const schedule = `${formatDate(c.startDate)} - ${formatDate(c.endDate)}`;
        const statusBadge = `<span class="status-badge status-${c.status || 'draft'}">${c.status || 'draft'}</span>`;
        const actions = `
            <button class="action-btn" onclick="window.viewCampaign('${c.id}')">View</button>
            ${c.status === 'active' ? `<button class="action-btn" onclick="window.pauseCampaign('${c.id}')">Pause</button>` : ''}
            ${c.status === 'paused' ? `<button class="action-btn" onclick="window.resumeCampaign('${c.id}')">Resume</button>` : ''}
            ${c.status === 'draft' || c.status === 'pending' ? `<button class="action-btn danger" onclick="window.deleteCampaign('${c.id}')">Delete</button>` : ''}
        `;

        return `
            <tr>
                <td><strong>${escapeHtml(c.name || 'Unnamed')}</strong></td>
                <td>${statusBadge}</td>
                <td>${escapeHtml(c.objective || 'N/A')}</td>
                <td>${escapeHtml(c.adType || 'N/A')}</td>
                <td>${impressions.toLocaleString()}</td>
                <td>${clicks.toLocaleString()}</td>
                <td>${ctr}%</td>
                <td>${spent}</td>
                <td>${schedule}</td>
                <td>${actions}</td>
            </tr>
        `;
    }).join('');

    // Mobile Cards
    cardsContainer.innerHTML = paginatedItems.map(c => {
        const impressions = c.impressions || 0;
        const clicks = c.clicks || 0;
        const ctr = calculateCTR(clicks, impressions);
        const spent = formatCurrency(c.spent || 0);
        const statusBadge = `<span class="status-badge status-${c.status || 'draft'}">${c.status || 'draft'}</span>`;
        
        return `
            <div class="mobile-card">
                <div class="mobile-card-header">
                    <h3>${escapeHtml(c.name || 'Unnamed')}</h3>
                    ${statusBadge}
                </div>
                <div class="mobile-card-stats">
                    <span>Impressions: ${impressions.toLocaleString()}</span>
                    <span>Clicks: ${clicks.toLocaleString()}</span>
                    <span>CTR: ${ctr}%</span>
                    <span>Spent: ${spent}</span>
                    <span>Type: ${escapeHtml(c.adType || 'N/A')}</span>
                    <span>Obj: ${escapeHtml(c.objective || 'N/A')}</span>
                </div>
                <div class="mobile-card-actions">
                    <button class="btn btn-sm btn-outline" onclick="window.viewCampaign('${c.id}')">View</button>
                    ${c.status === 'active' ? `<button class="btn btn-sm btn-warning" onclick="window.pauseCampaign('${c.id}')">Pause</button>` : ''}
                    ${c.status === 'paused' ? `<button class="btn btn-sm btn-success" onclick="window.resumeCampaign('${c.id}')">Resume</button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const container = document.getElementById('pagination-controls');
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="window.changePage(${currentPage - 1})">&laquo;</button>`;

    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="window.changePage(${i})">${i}</button>`;
    }

    html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.changePage(${currentPage + 1})">&raquo;</button>`;

    container.innerHTML = html;
}

function showEmptyState() {
    const html = `
        <div class="text-center p-4">
            <h3>No campaigns found</h3>
            <p class="text-muted">Create your first advertisement and start reaching your audience.</p>
            <a href="create-ad.html" class="btn btn-primary mt-2">Create Your First Campaign</a>
        </div>
    `;
    document.getElementById('campaigns-tbody').innerHTML = `<tr><td colspan="10">${html}</td></tr>`;
    document.getElementById('campaigns-cards-container').innerHTML = html;
}

// ==========================================
// CAMPAIGN ACTIONS
// ==========================================

window.changePage = function(page) {
    currentPage = page;
    renderCampaigns();
};

window.pauseCampaign = async function(id) {
    confirmAction('Pause Campaign', 'Are you sure you want to pause this campaign?', async () => {
        try {
            await update(ref(database, 'campaigns/' + id), { status: 'paused' });
            showNotification('Campaign paused successfully.', 'success');
            loadCampaigns();
        } catch (error) {
            console.error('Error pausing campaign:', error);
            showNotification('Failed to pause campaign.', 'error');
        }
    });
};

window.resumeCampaign = async function(id) {
    confirmAction('Resume Campaign', 'Are you sure you want to resume this campaign?', async () => {
        try {
            await update(ref(database, 'campaigns/' + id), { status: 'active' });
            showNotification('Campaign resumed successfully.', 'success');
            loadCampaigns();
        } catch (error) {
            console.error('Error resuming campaign:', error);
            showNotification('Failed to resume campaign.', 'error');
        }
    });
};

window.deleteCampaign = async function(id) {
    confirmAction('Delete Campaign', 'Warning: This campaign will be permanently removed.', async () => {
        try {
            await remove(ref(database, 'campaigns/' + id));
            showNotification('Campaign deleted.', 'success');
            loadCampaigns();
        } catch (error) {
            console.error('Error deleting campaign:', error);
            showNotification('Failed to delete campaign.', 'error');
        }
    });
};

window.duplicateCampaign = async function(id) {
    const camp = allCampaigns.find(c => c.id === id);
    if (!camp) return;

    try {
        const newCampaignRef = push(ref(database, 'campaigns'));
        const { id: oldId, ...campData } = camp;
        
        const duplicateData = {
            ...campData,
            name: `${camp.name} (Copy)`,
            status: 'draft',
            spent: 0,
            impressions: 0,
            clicks: 0,
            createdAt: Date.now()
        };

        await set(newCampaignRef, duplicateData);
        showNotification('Campaign duplicated as draft.', 'success');
        loadCampaigns();
    } catch (error) {
        console.error('Error duplicating campaign:', error);
        showNotification('Failed to duplicate campaign.', 'error');
    }
};

// ==========================================
// CAMPAIGN DETAILS MODAL
// ==========================================

window.viewCampaign = function(id) {
    const camp = allCampaigns.find(c => c.id === id);
    if (!camp) return;

    const modalHtml = `
        <div class="detail-section">
            <h4>Campaign Information</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Name</label><span>${escapeHtml(camp.name || 'N/A')}</span></div>
                <div class="detail-item"><label>Status</label><span class="status-badge status-${camp.status || 'draft'}">${camp.status || 'draft'}</span></div>
                <div class="detail-item"><label>Objective</label><span>${escapeHtml(camp.objective || 'N/A')}</span></div>
                <div class="detail-item"><label>Category</label><span>${escapeHtml(camp.category || 'N/A')}</span></div>
                <div class="detail-item"><label>Created</label><span>${formatDate(camp.createdAt)}</span></div>
                <div class="detail-item"><label>Schedule</label><span>${formatDate(camp.startDate)} to ${formatDate(camp.endDate)}</span></div>
            </div>
        </div>

        <div class="detail-section">
            <h4>Performance</h4>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-label">Impressions</div><div class="stat-value">${(camp.impressions || 0).toLocaleString()}</div></div>
                <div class="stat-card"><div class="stat-label">Clicks</div><div class="stat-value">${(camp.clicks || 0).toLocaleString()}</div></div>
                <div class="stat-card"><div class="stat-label">CTR</div><div class="stat-value">${calculateCTR(camp.clicks || 0, camp.impressions || 0)}%</div></div>
                <div class="stat-card"><div class="stat-label">Spent</div><div class="stat-value">${formatCurrency(camp.spent || 0)}</div></div>
            </div>
        </div>

        <div class="detail-section">
            <h4>Advertisement Preview</h4>
            <div class="ad-preview-wrapper">
                <div class="ad-preview-modes">
                    <button class="btn btn-sm btn-outline" onclick="window.togglePreviewMode('desktop')">Desktop</button>
                    <button class="btn btn-sm btn-outline" onclick="window.togglePreviewMode('mobile')">Mobile</button>
                </div>
                <div class="ad-preview-container" id="ad-preview-container">
                    ${renderAdPreview(camp)}
                </div>
            </div>
        </div>

        ${camp.schedule ? `
        <div class="detail-section">
            <h4>Schedule Details</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Start Time</label><span>${camp.schedule.startTime || 'N/A'}</span></div>
                <div class="detail-item"><label>End Time</label><span>${camp.schedule.endTime || 'N/A'}</span></div>
                <div class="detail-item" style="grid-column: span 2;"><label>Active Days</label><span>${formatActiveDays(camp.schedule.days)}</span></div>
            </div>
        </div>
        ` : ''}

        ${camp.trackingUrl ? `
        <div class="detail-section">
            <h4>Tracking</h4>
            <div class="detail-grid">
                <div class="detail-item" style="grid-column: span 2;"><label>Tracking URL</label><span>${escapeHtml(camp.trackingUrl)}</span></div>
            </div>
        </div>
        ` : ''}
    `;

    showModal('Campaign Details', modalHtml, [
        { label: 'Close', class: 'btn-outline', onClick: (modal, close) => close() },
        camp.status === 'active' ? { label: 'Pause', class: 'btn-warning', onClick: async (modal, close) => { await window.pauseCampaign(camp.id); close(); } } : null,
        camp.status === 'paused' ? { label: 'Resume', class: 'btn-success', onClick: async (modal, close) => { await window.resumeCampaign(camp.id); close(); } } : null
    ].filter(Boolean));
};

window.togglePreviewMode = function(mode) {
    const container = document.getElementById('ad-preview-container');
    if (container) {
        const card = container.querySelector('.ad-card');
        if (card) {
            if (mode === 'mobile') {
                card.classList.add('mobile-mode');
            } else {
                card.classList.remove('mobile-mode');
            }
        }
    }
}

function renderAdPreview(camp) {
    const type = camp.adType || 'text';
    const brandName = camp.brandName || camp.advertiserName || 'Advertiser';
    const logoUrl = camp.brandLogoUrl || camp.brandLogo;
    const title = camp.title || 'Ad Title';
    const desc = camp.description || '';
    const cta = camp.cta || 'Learn More';
    const destUrl = camp.destinationUrl || '#';
    
    let domain = 'example.com';
    try { if (camp.destinationUrl) domain = new URL(camp.destinationUrl).hostname; } catch(e) {}

    let logoHtml = logoUrl ? 
        `<img src="${escapeHtml(logoUrl)}" class="ad-logo" alt="Logo" onerror="this.style.display='none'">` : 
        '';
        
    let mediaHtml = '';
    if (type === 'image' && camp.imageUrl) {
        mediaHtml = `<div class="ad-media"><img src="${escapeHtml(camp.imageUrl)}" alt="Ad" onerror="this.parentElement.innerHTML='<div style=&quot;display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;&quot;>Image unavailable</div>'"></div>`;
    } else if (type === 'video' && camp.videoUrl) {
        mediaHtml = `<div class="ad-media"><video src="${escapeHtml(camp.videoUrl)}" controls muted playsinline onerror="this.parentElement.innerHTML='<div style=&quot;display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;&quot;>Video unavailable</div>'"></video></div>`;
    }

    return `
        <div class="ad-card ${type === 'text' ? 'text-only' : ''}">
            <div class="ad-header">
                ${logoHtml}
                <div>
                    <p class="ad-title">${escapeHtml(brandName)}</p>
                    <span class="ad-sponsored">Sponsored</span>
                </div>
            </div>
            ${mediaHtml}
            <div class="ad-content">
                <h5>${escapeHtml(title)}</h5>
                <p>${escapeHtml(desc)}</p>
                <a href="${escapeHtml(destUrl)}" target="_blank" rel="noopener noreferrer" class="ad-cta">${escapeHtml(cta)}</a>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.5rem; text-align: center;">${escapeHtml(domain)}</div>
            </div>
        </div>
    `;
}

function formatActiveDays(days) {
    if (!days) return 'Not scheduled';
    const activeDays = Object.keys(days).filter(d => days[d]).map(d => d.charAt(0).toUpperCase() + d.slice(1, 3));
    return activeDays.length > 0 ? activeDays.join(', ') : 'No active days';
}

// ==========================================
// HELPERS
// ==========================================

function confirmAction(title, message, onConfirm) {
    showModal(title, `<p>${message}</p>`, [
        { label: 'Cancel', class: 'btn-outline', onClick: (modal, close) => close() },
        { label: 'Confirm', class: 'btn-danger', onClick: async (modal, close) => { await onConfirm(); close(); } }
    ]);
}
