export class ImpressionTracker {
 constructor() {
  // IMPORTANT: Replace with your actual deployed Cloud Function URL
  this.endpoint = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/recordImpression';
 }
 
 track(adId) {
  if (!adId) return;
  
  const data = JSON.stringify({
   adId: adId,
   timestamp: Date.now()
  });
  
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
   }).catch(e => console.error('Impression tracking failed', e));
  }
 }
}