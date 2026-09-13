import { auth, database } from './firebase.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { showNotification } from './notifications.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

async function loadProfile() {
 const user = auth.currentUser;
 if (!user) return;
 
 try {
  const snapshot = await get(ref(database, 'users/' + user.uid));
  if (snapshot.exists()) {
   const data = snapshot.val();
   document.getElementById('profile-uid').value = user.uid;
   document.getElementById('profile-name').value = data.name || '';
   document.getElementById('profile-email').value = data.email || '';
   document.getElementById('profile-status').value = data.status || 'unknown';
   document.getElementById('profile-created').value = new Date(data.createdAt).toLocaleString();
  }
 } catch (error) {
  showNotification('Error loading profile.', 'error');
 }
}

document.addEventListener('DOMContentLoaded', () => {
 const form = document.getElementById('profile-form');
 if (form) {
  form.addEventListener('submit', async (e) => {
   e.preventDefault();
   const newName = document.getElementById('profile-name').value;
   
   try {
    // Only update the name. Email changes require Firebase Auth functions.
    // Balance/Status are ignored entirely from this form.
    await update(ref(database, 'users/' + auth.currentUser.uid), { name: newName });
    showNotification('Profile updated successfully!', 'success');
    
    // Update nav username
    const navUsername = document.getElementById('nav-username');
    if (navUsername) navUsername.innerText = newName;
   } catch (error) {
    showNotification('Failed to update profile.', 'error');
   }
  });
 }
});

onAuthStateChanged(auth, (user) => {
 if (user) loadProfile();
});