export class AdSelector {
 /**
  * In the Publisher SDK, we NEVER select the ad.
  * The Cloud Function returns exactly ONE ad to display.
  * This class is a placeholder for any client-side rotation logic 
  * if the server ever returns a batch of ads (not recommended for security).
  */
 selectFromPool(ads) {
  if (!ads || !Array.isArray(ads) || ads.length === 0) return null;
  return ads[Math.floor(Math.random() * ads.length)];
 }
}