import { AdLoader } from './ad-loader.js';
import { ImpressionTracker } from './impression-tracker.js';
import { ClickTracker } from './click-tracker.js';

class MariaAdsSDK {
  constructor() {
    this.adLoader = new AdLoader();
    this.impressionTracker = new ImpressionTracker();
    this.clickTracker = new ClickTracker();
    this.observer = null;
    this.initialized = false;
  }
  
  init() {
    if (this.initialized) return;
    this.initialized = true;
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.scan());
    } else {
      this.scan();
    }
    
    // Setup MutationObserver for dynamically added ads
    this.setupMutationObserver();
  }
  
  // Scans the DOM for ad containers and initializes them
  scan() {
    const containers = document.querySelectorAll('.maria-ad, [data-maria-ad]');
    containers.forEach(container => {
      if (!container.getAttribute('data-maria-init')) {
        this.initializeContainer(container);
      }
    });
  }
  
  // Refreshes all ads on the page
  refresh() {
    const containers = document.querySelectorAll('.maria-ad, [data-maria-ad]');
    containers.forEach(container => {
      // Reset state
      container.removeAttribute('data-maria-init');
      container.innerHTML = '';
      this.initializeContainer(container);
    });
  }
  
  async initializeContainer(container) {
    container.setAttribute('data-maria-init', 'true');
    
    // Support both class and data attribute
    const placementId = container.getAttribute('data-placement') || container.getAttribute('data-maria-ad');
    if (!placementId) return;
    
    // Inject skeleton loader
    this.renderSkeleton(container);
    
    try {
      const adData = await this.adLoader.fetchAd(placementId, window.location.href);
      
      if (adData) {
        this.renderAd(container, adData);
      } else {
        // Fail gracefully, leave empty
        container.innerHTML = '';
      }
    } catch (error) {
      console.error('[Maria Ads] Error loading ad:', error);
      container.innerHTML = ''; // Fail gracefully
    }
  }
  
  renderSkeleton(container) {
    container.innerHTML = '';
    const skeleton = document.createElement('div');
    skeleton.style.cssText = 'min-height: 50px; background: #f0f0f0; border-radius: 4px; animation: pulse 1.5s infinite;';
    container.appendChild(skeleton);
  }
  
  renderAd(container, ad) {
    container.innerHTML = ''; // Clear skeleton
    
    // Store ad metadata in data attributes on the inner element
    // This is crucial for the Popup script to safely extract ad data without moving the DOM element
    const adWrapper = document.createElement('a');
    adWrapper.className = 'maria-ad-inner';
    adWrapper.style.cssText = 'cursor: pointer; display: block; text-decoration: none; color: inherit;';
    
    adWrapper.setAttribute('data-ad-id', ad.adId || '');
    adWrapper.setAttribute('data-click-token', ad.clickToken || '');
    adWrapper.setAttribute('data-tracking-token', ad.trackingToken || '');
    adWrapper.setAttribute('data-destination-url', ad.destinationUrl || '');
    adWrapper.setAttribute('data-title', ad.title || '');
    adWrapper.setAttribute('data-description', ad.description || '');
    adWrapper.setAttribute('data-image-url', ad.imageUrl || '');
    adWrapper.setAttribute('data-video-url', ad.videoUrl || '');
    
    // Use safe DOM creation
    if (ad.type === 'image' && ad.imageUrl) {
      const img = document.createElement('img');
      img.src = ad.imageUrl;
      img.alt = ad.title || 'Advertisement';
      img.style.cssText = 'max-width: 100%; height: auto; display: block; border: 0;';
      img.loading = 'lazy';
      adWrapper.appendChild(img);
    } else if (ad.type === 'video' && ad.videoUrl) {
      const video = document.createElement('video');
      video.src = ad.videoUrl;
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = 'max-width: 100%; height: auto; display: block;';
      video.controls = true;
      adWrapper.appendChild(video);
    }
    
    if (ad.title) {
      const title = document.createElement('h4');
      title.textContent = ad.title; // Safe text injection
      title.style.cssText = 'margin: 5px 0 0 0; font-size: 16px; font-family: sans-serif;';
      adWrapper.appendChild(title);
    }
    
    if (ad.description) {
      const desc = document.createElement('p');
      desc.textContent = ad.description;
      desc.style.cssText = 'margin: 2px 0 0 0; font-size: 14px; font-family: sans-serif; color: #555;';
      adWrapper.appendChild(desc);
    }
    
    // Attach secure click tracker
    this.clickTracker.attachClickEvent(adWrapper, ad.clickToken, ad.destinationUrl);
    
    container.appendChild(adWrapper);
    
    // Track impression using IntersectionObserver
    this.impressionTracker.observe(container, ad.trackingToken || ad.adId);
  }
  
  setupMutationObserver() {
    const targetNode = document.body;
    const config = { childList: true, subtree: true };
    
    this.observer = new MutationObserver((mutationsList, observer) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              if (node.matches('.maria-ad, [data-maria-ad]') && !node.getAttribute('data-maria-init')) {
                this.initializeContainer(node);
              }
              // Also check children of added nodes
              const innerAds = node.querySelectorAll('.maria-ad, [data-maria-ad]');
              innerAds.forEach(innerAd => {
                if (!innerAd.getAttribute('data-maria-init')) {
                  this.initializeContainer(innerAd);
                }
              });
            }
          });
        }
      }
    });
    
    this.observer.observe(targetNode, config);
  }
}

// Initialize global object
window.MariaAds = window.MariaAds || {};
const instance = new MariaAdsSDK();

window.MariaAds.init = () => instance.init();
window.MariaAds.scan = () => instance.scan();
window.MariaAds.refresh = () => instance.refresh();

// Auto-init on script load
window.MariaAds.init();
