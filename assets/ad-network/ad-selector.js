export class AdSelector {
 /**
  * Selects a random ad from a pool of eligible ads.
  * This is a fallback; the Cloud Function should ideally return ONE optimized ad.
  */
 selectRandom(ads) {
  if (!ads || !Array.isArray(ads) || ads.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * ads.length);
  return ads[randomIndex];
 }
}