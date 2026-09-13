export class ClickTracker {
 constructor() {
  // IMPORTANT: Replace with your actual deployed Cloud Function URL
  this.endpoint = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/recordClick';
 }
 
 attachClickEvent(element, clickToken, destinationUrl) {
  element.addEventListener('click', async (e) => {
   e.preventDefault(); // Stop immediate navigation
   
   // Validate URL before redirecting (Security requirement)
   if (!this.isValidUrl(destinationUrl)) {
    console.error('[Maria Ads] Invalid destination URL blocked');
    return;
   }
   
   try {
    // Send click data. We use fetch with keepalive to ensure it finishes
    if (clickToken) {
     await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clickToken }),
      keepalive: true
     });
    }
   } catch (error) {
    console.error('[Maria Ads] Click tracking failed', error);
   } finally {
    // Redirect the user regardless of tracking success to not harm UX
    if (destinationUrl) {
     window.open(destinationUrl, '_blank');
    }
   }
  });
 }
 
 // Security: Only allow http/https URLs
 isValidUrl(url) {
  if (!url) return false;
  try {
   const parsed = new URL(url);
   return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
   return false;
  }
 }
}