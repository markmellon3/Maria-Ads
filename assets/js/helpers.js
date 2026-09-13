// Validate URL format and ensure it's HTTP/HTTPS
export function isValidUrl(string) {
 try {
  const url = new URL(string);
  return url.protocol === "http:" || url.protocol === "https:";
 } catch (_) {
  return false;
 }
}

// Format numbers into currency
export function formatCurrency(amount) {
 return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

// Format dates to a readable string
export function formatDate(timestamp) {
 if (!timestamp) return 'N/A';
 const date = new Date(timestamp);
 return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Escape HTML to prevent XSS attacks
export function escapeHtml(unsafe) {
 if (!unsafe) return '';
 return unsafe
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
}

// Generate a random ID (for client-side use, Firebase push() is preferred for DB entries)
export function generateId(prefix = 'id') {
 return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Calculate Click-Through Rate
export function calculateCTR(clicks, impressions) {
 if (!impressions || impressions === 0) return '0.00%';
 return ((clicks / impressions) * 100).toFixed(2) + '%';
}