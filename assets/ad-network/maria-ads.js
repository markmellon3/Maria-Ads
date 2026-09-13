import { AdLoader } from './ad-loader.js';
import { ImpressionTracker } from './impression-tracker.js';
import { ClickTracker } from './click-tracker.js';

class MariaAds {
 constructor() {
  this.placements = [];
  this.adLoader = new AdLoader();
  this.impressionTracker = new ImpressionTracker();
  this.clickTracker = new ClickTracker();
 }
 
 init() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
   document.addEventListener('DOMContentLoaded', () => this.start());
  } else {
   this.start();
  }
 }
 
 start() {
  this.findPlacements();
  this.loadAds();
 }
 
 findPlacements() {
  const elements = document.querySelectorAll('.maria-ad');
  elements.forEach(el => {
   // Prevent duplicate initialization
   if (!el.getAttribute('data-maria-init')) {
    el.setAttribute('data-maria-init', 'true');
    this.placements.push({
     element: el,
     placementId: el.getAttribute('data-placement')
    });
   }
  });
 }
 
 async loadAds() {
  for (const p of this.placements) {
   try {
    // Show loading state
    p.element.innerHTML = '<div style="min-height: 50px; background: #f0f0f0; animation: pulse 1.5s infinite;"></div>';
    
    const adData = await this.adLoader.fetchAd(p.placementId);
    
    if (adData) {
     this.renderAd(p, adData);
    } else {
     this.renderEmpty(p);
    }
   } catch (error) {
    console.error('Maria Ads Error:', error);
    this.renderEmpty(p);
   }
  }
 }
 
 renderAd(placement, ad) {
  const { element } = placement;
  element.innerHTML = ''; // Clear loading state
  
  const adWrapper = document.createElement('div');
  adWrapper.className = 'maria-ad-inner';
  adWrapper.style.cursor = 'pointer';
  adWrapper.setAttribute('data-ad-id', ad.adId);
  
  // Safely construct ad HTML based on type
  let adContent = '';
  if (ad.type === 'image' && ad.imageUrl) {
   adContent = `<img src="${ad.imageUrl}" alt="${ad.title || 'Advertisement'}" style="max-width:100%; height:auto; display:block; border:0;">`;
  } else if (ad.type === 'video' && ad.videoUrl) {
   adContent = `<video src="${ad.videoUrl}" controls style="max-width:100%; display:block;"></video>`;
  }
  
  if (ad.title) adContent += `<h4 style="margin:5px 0; font-size:16px;">${ad.title}</h4>`;
  if (ad.description) adContent += `<p style="margin:0; font-size:14px;">${ad.description}</p>`;
  
  adWrapper.innerHTML = adContent;
  
  // Attach click tracker
  this.clickTracker.attachClickEvent(adWrapper, ad.adId, ad.destinationUrl);
  
  element.appendChild(adWrapper);
  
  // Track impression
  this.impressionTracker.track(ad.adId);
 }
 
 renderEmpty(placement) {
  // Fail gracefully - empty the container
  placement.element.innerHTML = '';
 }
}

// Auto-initialize on script load
const mariaAdsInstance = new MariaAds();
mariaAdsInstance.init();

// Export for manual re-initialization if needed (e.g., SPA navigation)
export default mariaAdsInstance;