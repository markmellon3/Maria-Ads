export class ImpressionTracker {
 constructor() {
  // IMPORTANT: Replace with your actual deployed Cloud Function URL
  this.endpoint = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/recordImpression';
  this.observedAds = new Map();
  this.initObserver();
 }
 
 initObserver() {
  const options = {
   root: null,
   rootMargin: '0px',
   threshold: 0.5 // 50% of ad must be visible
  };
  
  this.observer = new IntersectionObserver((entries, observer) => {
   entries.forEach(entry => {
    if (entry.isIntersecting) {
     const element = entry.target;
     const trackingToken = this.observedAds.get(element);
     
     if (trackingToken) {
      this.track(trackingToken);
      // Stop observing after first impression to prevent duplicates
      observer.unobserve(element);
      this.observedAds.delete(element);
     }
    }
   });
  }, options);
 }
 
 observe(element, trackingToken) {
  if (!trackingToken) return;
  this.observedAds.set(element, trackingToken);
  this.observer.observe(element);
 }
 
 track(trackingToken) {
  const data = JSON.stringify({ trackingToken });
  
  // Use sendBeacon for reliability on page unload
  if (navigator.sendBeacon) {
   const blob = new Blob([data], { type: 'application/json' });
   navigator.sendBeacon(this.endpoint, blob);
  } else {
   // Fallback to fetch
   fetch(this.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data,
    keepalive: true
   }).catch(e => console.error('[Maria Ads] Impression tracking failed', e));
  }
 }
}