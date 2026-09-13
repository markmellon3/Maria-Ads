document.addEventListener('DOMContentLoaded', () => {
 const sidebar = document.getElementById('sidebar');
 const menuToggle = document.getElementById('menu-toggle');
 const overlay = document.createElement('div');
 overlay.className = 'sidebar-overlay';
 document.body.appendChild(overlay);
 
 // Mobile menu toggle
 if (menuToggle && sidebar) {
  menuToggle.addEventListener('click', () => {
   sidebar.classList.add('active');
   overlay.classList.add('active');
  });
  
  overlay.addEventListener('click', () => {
   sidebar.classList.remove('active');
   overlay.classList.remove('active');
  });
 }
 
 // --- NEW: Highlight Active Sidebar Link ---
 const navLinks = document.querySelectorAll('.sidebar .nav-link');
 // Get the current page filename (e.g., 'dashboard.html')
 const currentPath = window.location.pathname.split('/').pop() || 'index.html';
 
 navLinks.forEach(link => {
  const linkPath = link.getAttribute('href');
  
  // Check if the link matches the current page
  if (linkPath === currentPath) {
   link.classList.add('active');
  } else {
   link.classList.remove('active');
  }
 });
 
 // Optional: Add shadow to navbar on scroll
 const navbar = document.querySelector('.navbar');
 if (navbar) {
  window.addEventListener('scroll', () => {
   if (window.scrollY > 10) {
    navbar.classList.add('is-scrolled');
   } else {
    navbar.classList.remove('is-scrolled');
   }
  });
 }
});