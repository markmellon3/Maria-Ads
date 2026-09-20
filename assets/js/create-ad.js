import { auth, database } from './firebase.js';
import { ref, get, push, set, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatCurrency, escapeHtml } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let currentUser = null;
let activeCampaignsCount = 0;
let isSubmitting = false;

// Initialize Page
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadWalletInfo();
        loadUserCampaigns();
        loadWebsites();
        initializeForm();
    } else {
        window.location.href = 'login.html'; // Or index.html depending on your auth-guard
    }
});

// ==========================================
// DATA LOADING
// ==========================================

async function loadWalletInfo() {
    if (!currentUser) return;
    
    const balanceElement = document.getElementById('wallet-balance');
    const activeCountElement = document.getElementById('active-campaigns-count');
    const currentRateElement = document.getElementById('current-billing-rate');

    try {
        const balanceRef = ref(database, 'users/' + currentUser.uid + '/balance');
        const balanceSnap = await get(balanceRef);
        
        if (balanceSnap.exists() && balanceSnap.val() !== null) {
            const balance = Number(balanceSnap.val()) || 0;
            balanceElement.textContent = formatCurrency(balance);
            balanceElement.style.color = balance > 0 ? '#10b981' : '#ef4444';
        } else {
            balanceElement.textContent = 'Unavailable';
            balanceElement.style.color = '#ef4444';
            console.warn('Wallet balance could not be loaded or is null.');
        }
    } catch (error) {
        console.error('Error loading wallet:', error);
        balanceElement.textContent = 'Error';
        balanceElement.style.color = '#ef4444';
    }

    // Update rates based on active campaigns
    activeCountElement.textContent = activeCampaignsCount;
    const rate = activeCampaignsCount * 0.020;
    currentRateElement.textContent = `$${rate.toFixed(3)} / min`;
}

async function loadUserCampaigns() {
    if (!currentUser) return;
    try {
        const campaignsRef = ref(database, 'campaigns');
        const userCampaignsQuery = query(campaignsRef, orderByChild('advertiserId'), equalTo(currentUser.uid));
        const snapshot = await get(userCampaignsQuery);
        
        if (snapshot.exists()) {
            const campaigns = Object.values(snapshot.val());
            activeCampaignsCount = campaigns.filter(c => c.status === 'active').length;
        } else {
            activeCampaignsCount = 0;
        }
        
        // Refresh wallet display with updated count
        loadWalletInfo();
    } catch (error) {
        console.error('Error loading campaigns:', error);
        activeCampaignsCount = 0;
        loadWalletInfo();
    }
}

async function loadWebsites() {
    if (!currentUser) return;
    const websiteSelect = document.getElementById('advertising-website');
    if (!websiteSelect) return;
    
    try {
        // Assuming structure: users/{uid}/websites/{pushId}/{url: "..."}
        const websitesRef = ref(database, 'users/' + currentUser.uid + '/websites');
        const snapshot = await get(websitesRef);
        
        if (snapshot.exists()) {
            const websites = snapshot.val();
            for (const key in websites) {
                const url = websites[key].url || websites[key];
                const option = document.createElement('option');
                option.value = url;
                option.textContent = url;
                websiteSelect.appendChild(option);
            }
        }
    } catch (error) {
        console.error('Error loading websites:', error);
    }

    // When user selects a website, auto-fill the destination URL
    websiteSelect.addEventListener('change', (e) => {
        if (e.target.value) {
            document.getElementById('destination-url').value = e.target.value;
            updatePreview();
            updateQualityIndicator();
        }
    });
}

// ==========================================
// FORM INITIALIZATION
// ==========================================

function initializeForm() {
    // Set default dates
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 7);
    
    document.getElementById('start-date').value = today.toISOString().split('T')[0];
    document.getElementById('end-date').value = tomorrow.toISOString().split('T')[0];

    // Ad Type change handler
    document.getElementById('ad-type').addEventListener('change', initializeAdTypeControls);
    initializeAdTypeControls();

    // Preview mode toggles
    document.querySelectorAll('.preview-modes button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.preview-modes button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const mode = e.target.getAttribute('data-mode');
            const previewArea = document.getElementById('ad-preview-area');
            previewArea.classList.remove('desktop-preview', 'mobile-preview');
            previewArea.classList.add(`${mode}-preview`);
        });
    });

    // Day presets
    document.querySelectorAll('.day-presets button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.target.getAttribute('data-days');
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            days.forEach(d => {
                const checkbox = document.getElementById(`day-${d}`);
                if (type === 'all') checkbox.checked = true;
                if (type === 'weekdays') checkbox.checked = ['mon', 'tue', 'wed', 'thu', 'fri'].includes(d);
            });
        });
    });

    // Test Link button
    document.getElementById('test-link-btn').addEventListener('click', () => {
        const url = document.getElementById('destination-url').value;
        if (validateUrl(url)) {
            window.open(url, '_blank');
        } else {
            showNotification('Invalid URL', 'error');
        }
    });

    // Attach input listeners for live preview & quality
    const inputsToMonitor = [
        'campaign-name', 'ad-type', 'brand-name', 'brand-logo', 
        'ad-title', 'ad-description', 'image-url', 'video-url', 
        'destination-url', 'ad-cta'
    ];
    
    inputsToMonitor.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                updatePreview();
                updateQualityIndicator();
            });
        }
    });

    // Initial render
    updatePreview();
    updateQualityIndicator();

    // Form submissions
    document.getElementById('create-ad-form').addEventListener('submit', createCampaign);
    document.getElementById('save-draft-btn').addEventListener('click', saveDraft);
}

function initializeAdTypeControls() {
    const adType = document.getElementById('ad-type').value;
    const imageGroup = document.getElementById('image-url-group');
    const videoGroup = document.getElementById('video-url-group');
    
    if (adType === 'image') {
        imageGroup.style.display = 'block';
        videoGroup.style.display = 'none';
    } else if (adType === 'video') {
        imageGroup.style.display = 'none';
        videoGroup.style.display = 'block';
    } else {
        imageGroup.style.display = 'none';
        videoGroup.style.display = 'none';
    }
    updatePreview();
}

// ==========================================
// LIVE PREVIEW & QUALITY
// ==========================================

function updatePreview() {
    const adType = document.getElementById('ad-type').value;
    const brandName = document.getElementById('brand-name').value || 'Advertiser Name';
    const logoUrl = document.getElementById('brand-logo').value;
    const title = document.getElementById('ad-title').value || 'Ad Title';
    const description = document.getElementById('ad-description').value || 'Ad Description';
    const cta = document.getElementById('ad-cta').value || 'Learn More';
    const destUrl = document.getElementById('destination-url').value || 'https://example.com';
    
    let domain = 'example.com';
    try {
        domain = new URL(destUrl).hostname;
    } catch(e) {}

    let logoHtml = logoUrl ? 
        `<img src="${escapeHtml(logoUrl)}" class="ad-logo" alt="Logo" onerror="this.outerHTML='<div class=&quot;ad-logo-placeholder&quot;>${escapeHtml(brandName.charAt(0).toUpperCase())}</div>'">` : 
        `<div class="ad-logo-placeholder">${escapeHtml(brandName.charAt(0).toUpperCase())}</div>`;
        
    let mediaHtml = '';

    if (adType === 'image') {
        const imgUrl = document.getElementById('image-url').value;
        if (imgUrl) {
            mediaHtml = `<img src="${escapeHtml(imgUrl)}" class="ad-image" alt="Ad Image" onerror="this.parentElement.innerHTML='<div class=&quot;media-placeholder&quot;>Image unavailable</div>'">`;
        } else {
            mediaHtml = `<div class="media-placeholder">No Image Added</div>`;
        }
    } else if (adType === 'video') {
        const vidUrl = document.getElementById('video-url').value;
        if (vidUrl) {
            mediaHtml = `<video src="${escapeHtml(vidUrl)}" class="ad-video" controls muted playsinline onerror="this.parentElement.innerHTML='<div class=&quot;media-placeholder&quot;>Video unavailable</div>'"></video>`;
        } else {
            mediaHtml = `<div class="media-placeholder">No Video Added</div>`;
        }
    } else {
        // Text ad, no media
        mediaHtml = '';
    }

    const previewHTML = `
        <div class="ad-card ${adType === 'text' ? 'text-only-ad' : ''}">
            <div class="ad-header">
                ${logoHtml}
                <div class="ad-brand-info">
                    <span class="advertiser-name">${escapeHtml(brandName)}</span>
                    <span class="sponsored-tag">Sponsored</span>
                </div>
            </div>
            ${mediaHtml ? `<div class="ad-media">${mediaHtml}</div>` : ''}
            <div class="ad-content">
                <h4 class="ad-title">${escapeHtml(title)}</h4>
                <p class="ad-description">${escapeHtml(description)}</p>
                <button type="button" class="ad-cta">${escapeHtml(cta)}</button>
                <span class="ad-domain">${escapeHtml(domain)}</span>
            </div>
        </div>
    `;
    
    document.getElementById('ad-preview-area').innerHTML = previewHTML;
}

function updateQualityIndicator() {
    const checks = [
        { id: 'campaign-name', text: 'Campaign name' },
        { id: 'ad-title', text: 'Advertisement title' },
        { id: 'ad-description', text: 'Description' },
        { id: 'destination-url', text: 'Destination URL' },
        { id: 'ad-cta', text: 'CTA selected' },
        { id: 'brand-name', text: 'Advertiser/brand added' }
    ];

    let completeCount = 0;
    const listElement = document.getElementById('quality-checks');
    listElement.innerHTML = '';

    checks.forEach(check => {
        const el = document.getElementById(check.id);
        const isComplete = el && el.value.trim() !== '';
        
        if (isComplete) completeCount++;

        const itemClass = isComplete ? 'complete' : 'incomplete';
        const iconClass = isComplete ? 'fa-check-circle' : 'fa-circle';
        
        const item = document.createElement('div');
        item.className = `quality-check-item ${itemClass}`;
        item.innerHTML = `<i class="fas ${iconClass}"></i> ${check.text}`;
        listElement.appendChild(item);
    });

    // Check media if not text ad
    const adType = document.getElementById('ad-type').value;
    if (adType !== 'text') {
        const mediaId = adType === 'image' ? 'image-url' : 'video-url';
        const mediaEl = document.getElementById(mediaId);
        const mediaComplete = mediaEl && mediaEl.value.trim() !== '';
        
        if (mediaComplete) completeCount++;
        
        const mediaItem = document.createElement('div');
        mediaItem.className = `quality-check-item ${mediaComplete ? 'complete' : 'incomplete'}`;
        mediaItem.innerHTML = `<i class="fas ${mediaComplete ? 'fa-check-circle' : 'fa-circle'}"></i> Media added`;
        listElement.appendChild(mediaItem);
    }

    const totalChecks = adType === 'text' ? checks.length : checks.length + 1;
    const percentage = (completeCount / totalChecks) * 100;
    
    document.getElementById('quality-progress-bar').style.width = `${percentage}%`;
}

// ==========================================
// VALIDATION & HELPERS
// ==========================================

function validateUrl(urlString) {
    if (!urlString) return false;
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function buildTrackingUrl(destUrl) {
    if (!validateUrl(destUrl)) return destUrl;
    try {
        const url = new URL(destUrl);
        const source = document.getElementById('utm-source').value;
        const medium = document.getElementById('utm-medium').value;
        const campaign = document.getElementById('utm-campaign').value;
        const content = document.getElementById('utm-content').value;

        if (source) url.searchParams.set('utm_source', source);
        if (medium) url.searchParams.set('utm_medium', medium);
        if (campaign) url.searchParams.set('utm_campaign', campaign);
        if (content) url.searchParams.set('utm_content', content);
        
        return url.toString();
    } catch (e) {
        return destUrl;
    }
}

function getSelectedDays() {
    return {
        monday: document.getElementById('day-mon').checked,
        tuesday: document.getElementById('day-tue').checked,
        wednesday: document.getElementById('day-wed').checked,
        thursday: document.getElementById('day-thu').checked,
        friday: document.getElementById('day-fri').checked,
        saturday: document.getElementById('day-sat').checked,
        sunday: document.getElementById('day-sun').checked
    };
}

function validateForm(isDraft = false) {
    clearFormErrors();
    let isValid = true;

    const requiredFields = [
        { id: 'campaign-name', message: 'Campaign name is required' }
    ];

    if (!isDraft) {
        requiredFields.push(
            { id: 'campaign-objective', message: 'Objective is required' },
            { id: 'ad-title', message: 'Ad title is required' },
            { id: 'ad-cta', message: 'CTA is required' }
        );
    }

    requiredFields.forEach(field => {
        const el = document.getElementById(field.id);
        if (!el.value.trim()) {
            showFormError(field.id, field.message);
            isValid = false;
        }
    });

    if (!isDraft) {
        const destUrl = document.getElementById('destination-url').value;
        if (!validateUrl(destUrl)) {
            showFormError('destination-url', 'A valid HTTP/HTTPS URL is required');
            isValid = false;
        }

        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        
        if (!startDate) {
            showFormError('start-date', 'Start date is required');
            isValid = false;
        }
        if (!endDate) {
            showFormError('end-date', 'End date is required');
            isValid = false;
        }
        if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
            showFormError('end-date', 'End date cannot be before start date');
            isValid = false;
        }

        const adType = document.getElementById('ad-type').value;
        if (adType === 'image' && !document.getElementById('image-url').value.trim()) {
            showFormError('image-url', 'Image URL is required for image ads');
            isValid = false;
        }
        if (adType === 'video' && !document.getElementById('video-url').value.trim()) {
            showFormError('video-url', 'Video URL is required for video ads');
            isValid = false;
        }
    }

    return isValid;
}

function showFormError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.style.borderColor = '#ef4444';
        
        // Remove existing error message if any
        const existingError = field.parentNode.querySelector('.error-text');
        if (existingError) existingError.remove();

        const errorText = document.createElement('div');
        errorText.className = 'error-text';
        errorText.style.color = '#ef4444';
        errorText.style.fontSize = '0.75rem';
        errorText.style.marginTop = '0.25rem';
        errorText.textContent = message;
        
        field.parentNode.appendChild(errorText);
    }
}

function clearFormErrors() {
    document.querySelectorAll('.error-text').forEach(el => el.remove());
    document.querySelectorAll('input, select, textarea').forEach(el => {
        el.style.borderColor = '';
    });
}

function setButtonLoading(buttonId, isLoading, loadingText = 'Loading...', defaultText = 'Submit') {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ? 
        `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${loadingText}` : 
        defaultText;
}

// ==========================================
// CAMPAIGN CREATION
// ==========================================

function buildCampaignData(status) {
    const adType = document.getElementById('ad-type').value;
    const destUrl = document.getElementById('destination-url').value;
    
    const data = {
        advertiserId: currentUser.uid,
        name: document.getElementById('campaign-name').value,
        objective: document.getElementById('campaign-objective').value,
        destinationUrl: destUrl,
        trackingUrl: buildTrackingUrl(destUrl),
        startDate: document.getElementById('start-date').value,
        endDate: document.getElementById('end-date').value,
        schedule: {
            startTime: document.getElementById('start-time').value,
            endTime: document.getElementById('end-time').value,
            days: getSelectedDays()
        },
        adType: adType,
        brandName: document.getElementById('brand-name').value,
        brandLogo: document.getElementById('brand-logo').value,
        category: document.getElementById('brand-category').value,
        title: document.getElementById('ad-title').value,
        description: document.getElementById('ad-description').value,
        imageUrl: adType === 'image' ? document.getElementById('image-url').value : '',
        videoUrl: adType === 'video' ? document.getElementById('video-url').value : '',
        cta: document.getElementById('ad-cta').value,
        status: status,
        spent: 0,
        impressions: 0,
        clicks: 0,
        createdAt: Date.now(),
        // Preserve budget field for existing campaigns.js compatibility
        // Setting an extremely high budget so the billing engine doesn't pause it prematurely
        budget: 999999999 
    };

    return data;
}

async function saveDraft() {
    if (isSubmitting) return;
    if (!currentUser) return;

    if (!validateForm(true)) {
        showNotification('Please fix the errors before saving.', 'error');
        return;
    }

    isSubmitting = true;
    setButtonLoading('save-draft-btn', true, 'Saving...', 'Save Draft');

    try {
        const campaignData = buildCampaignData('draft');
        const campaignsRef = ref(database, 'campaigns');
        const newCampaignRef = push(campaignsRef);
        
        await set(newCampaignRef, campaignData);
        
        showNotification('Draft saved successfully!', 'success');
        setTimeout(() => { window.location.href = 'campaigns.html'; }, 1500);
    } catch (error) {
        console.error('Error saving draft:', error);
        showNotification('Failed to save draft.', 'error');
    } finally {
        isSubmitting = false;
        setButtonLoading('save-draft-btn', false, '', 'Save Draft');
    }
}

async function createCampaign(e) {
    e.preventDefault();
    if (isSubmitting) return;
    if (!currentUser) return;

    if (!validateForm(false)) {
        showNotification('Please fix the errors before creating the campaign.', 'error');
        return;
    }

    isSubmitting = true;
    setButtonLoading('create-campaign-btn', true, 'Creating Campaign...', 'Create Campaign');

    try {
        const campaignData = buildCampaignData('pending'); // Use 'pending' for approval workflow
        const campaignsRef = ref(database, 'campaigns');
        const newCampaignRef = push(campaignsRef);
        
        await set(newCampaignRef, campaignData);
        
        showNotification('Campaign created successfully! It is now pending approval.', 'success');
        setTimeout(() => { window.location.href = 'campaigns.html'; }, 1500);
    } catch (error) {
        console.error('Error creating campaign:', error);
        showNotification('Failed to create campaign.', 'error');
    } finally {
        isSubmitting = false;
        setButtonLoading('create-campaign-btn', false, '', 'Create Campaign');
    }
}
