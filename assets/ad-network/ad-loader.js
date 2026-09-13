export class AdLoader {
 constructor() {
  // IMPORTANT: Replace with your actual deployed Cloud Function URL
 this.endpoint = 'https://us-central1-maria-ad.cloudfunctions.net/recordClick;
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
