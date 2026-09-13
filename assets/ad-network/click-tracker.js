export class ClickTracker {
 constructor() {
  // IMPORTANT: Replace with your actual deployed Cloud Function URL
  this.endpoint = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/recordClick';
 }
 
 attachClickEvent(element, adId, destinationUrl) {
  element.addEventListener('click', async (e) => {
   e.preventDefault(); // Stop immediate navigation
   
   try {
    // Send click data. We use fetch with keepalive to ensure it finishes
    await fetch(this.endpoint, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
      adId: adId,
      timestamp: Date.now()
     }),
     keepalive: true
    });
   } catch (error) {
    console.error('Click tracking failed', error);
   } finally {
    // Redirect the user regardless of tracking success to not harm UX
    if (destinationUrl) {
     window.open(destinationUrl, '_blank');
    }
   }
  });
 }
}