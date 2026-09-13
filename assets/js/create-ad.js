import { auth, database } from './firebase.js';
import { ref, push, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { showNotification } from './notifications.js';
import { isValidUrl, escapeHtml } from './helpers.js';

document.addEventListener('DOMContentLoaded', () => {
 const form = document.getElementById('create-ad-form');
 const adTypeSelect = document.getElementById('ad-type');
 const imageUrlGroup = document.getElementById('image-url-group');
 const videoUrlGroup = document.getElementById('video-url-group');
 const previewArea = document.getElementById('ad-preview-area');
 
 // Toggle URL fields based on Ad Type
 adTypeSelect.addEventListener('change', () => {
  if (adTypeSelect.value === 'image') {
   imageUrlGroup.style.display = 'block';
   videoUrlGroup.style.display = 'none';
  } else if (adTypeSelect.value === 'video') {
   imageUrlGroup.style.display = 'none';
   videoUrlGroup.style.display = 'block';
  } else {
   imageUrlGroup.style.display = 'none';
   videoUrlGroup.style.display = 'none';
  }
  updatePreview();
 });
 
 // Live Preview
 form.addEventListener('input', updatePreview);
 
 function updatePreview() {
  const type = adTypeSelect.value;
  const title = document.getElementById('ad-title').value;
  const desc = document.getElementById('ad-description').value;
  const imgUrl = document.getElementById('image-url').value;
  const vidUrl = document.getElementById('video-url').value;
  
  let html = '';
  
  if (type === 'image' && imgUrl) {
   html += `<img src="${escapeHtml(imgUrl)}" alt="Ad Preview" style="max-width:100%; max-height:200px; border-radius:4px;">`;
  } else if (type === 'video' && vidUrl) {
   html += `<video src="${escapeHtml(vidUrl)}" controls style="max-width:100%; max-height:200px; border-radius:4px;"></video>`;
  }
  
  if (title) html += `<h4>${escapeHtml(title)}</h4>`;
  if (desc) html += `<p>${escapeHtml(desc)}</p>`;
  
  previewArea.innerHTML = html || '<p>Fill out the form to see a preview.</p>';
 }
 
 // Form Submission
 form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return showNotification('User not authenticated.', 'error');
  
  const submitBtn = document.getElementById('save-ad-btn');
  submitBtn.innerText = 'Saving...';
  submitBtn.disabled = true;
  
  try {
   const campaignName = document.getElementById('campaign-name').value;
   const startDate = document.getElementById('start-date').value;
   const endDate = document.getElementById('end-date').value;
   const totalBudget = parseFloat(document.getElementById('total-budget').value);
   const dailyBudget = parseFloat(document.getElementById('daily-budget').value);
   
   const adType = adTypeSelect.value;
   const adTitle = document.getElementById('ad-title').value;
   const adDesc = document.getElementById('ad-description').value;
   const imgUrl = document.getElementById('image-url').value;
   const vidUrl = document.getElementById('video-url').value;
   const destUrl = document.getElementById('destination-url').value;
   
   // Validations
   if (new Date(startDate) > new Date(endDate)) throw new Error('Start date must be before end date.');
   if (totalBudget <= 0 || dailyBudget <= 0) throw new Error('Budgets must be greater than 0.');
   if (!isValidUrl(destUrl)) throw new Error('Destination URL is invalid. Must start with http:// or https://');
   
   if (adType === 'image' && !isValidUrl(imgUrl)) throw new Error('Image URL is invalid.');
   if (adType === 'video' && !isValidUrl(vidUrl)) throw new Error('Video URL is invalid.');
   
   // Save Campaign
   const campaignsRef = ref(database, 'campaigns');
   const newCampaignRef = push(campaignsRef);
   const campaignId = newCampaignRef.key;
   
   await set(newCampaignRef, {
    advertiserId: user.uid,
    name: campaignName,
    status: 'pending', // Requires admin approval or payment in real scenario
    budget: totalBudget,
    dailyBudget: dailyBudget,
    spent: 0,
    startDate: startDate,
    endDate: endDate,
    createdAt: Date.now()
   });
   
   // Save Ad
   const adsRef = ref(database, 'ads');
   const newAdRef = push(adsRef);
   
   await set(newAdRef, {
    campaignId: campaignId,
    advertiserId: user.uid,
    type: adType,
    title: adTitle,
    description: adDesc,
    imageUrl: adType === 'image' ? imgUrl : '',
    videoUrl: adType === 'video' ? vidUrl : '',
    destinationUrl: destUrl,
    status: 'pending',
    createdAt: Date.now()
   });
   
   showNotification('Campaign created successfully!', 'success');
   window.location.href = 'campaigns.html';
   
  } catch (error) {
   console.error("Create Ad Error:", error);
   showNotification(error.message || 'Failed to create campaign.', 'error');
   submitBtn.innerText = 'Save Campaign';
   submitBtn.disabled = false;
  }
 });
});