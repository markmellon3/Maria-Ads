export class AdLoader {
 constructor() {
  // IMPORTANT: Replace with your actual deployed Cloud Function URL
  this.endpoint = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/getEligibleAd';
 }
 
 async fetchAd(placementId) {
  if (!placementId) return null;
  
  try {
   const response = await fetch(this.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     placementId: placementId,
     // Send page URL for contextual targeting later
     pageUrl: window.location.href
    })
   });
   
   if (!response.ok) return null;
   
   const data = await response.json();
   // Expecting: { adId, type, title, description, imageUrl, videoUrl, destinationUrl }
   return data.ad || null;
  } catch (error) {
   console.error('Maria Ads AdLoader Error:', error);
   return null;
  }
 }
}