export function showNotification(message, type = 'info', duration = 4000) {
 const container = document.getElementById('notification-container');
 if (!container) return;
 
 const notification = document.createElement('div');
 notification.className = `notification notification-${type}`;
 notification.innerText = message;
 
 container.appendChild(notification);
 
 // Trigger fade in
 setTimeout(() => notification.classList.add('show'), 10);
 
 // Remove after duration
 setTimeout(() => {
  notification.classList.remove('show');
  setTimeout(() => notification.remove(), 300);
 }, duration);
}