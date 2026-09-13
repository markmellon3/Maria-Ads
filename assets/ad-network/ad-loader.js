export class AdLoader {
 constructor() {
  // Added /api/getEligibleAd to the end of your Railway URL
  this.endpoint = 'https://maria-ads-backend-production.up.railway.app/api/getEligibleAd';
 }
 
 async fetchAd(placementId, pageUrl) {
  if (!placementId) return null;
  
  try {
   const response = await fetch(this.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     placementId: placementId,
     pageUrl: pageUrl
    })
   });
   
   if (!response.ok) return null;
   
   const data = await response.json();
   // Expecting: { adId, type, title, description, imageUrl, videoUrl, destinationUrl, clickToken, trackingToken }
   return data.ad || null;
  } catch (error) {
   console.error('[Maria Ads] AdLoader Error:', error);
   return null;
  }
 }
}
