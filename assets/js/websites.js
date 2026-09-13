import { auth, database } from './firebase.js';
import { ref, get, push, set, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { formatDate, escapeHtml } from './helpers.js';
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

async function loadWebsites() {
 const user = auth.currentUser;
 if (!user) return;
 
 const tbody = document.getElementById('websites-tbody');
 tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading websites...</td></tr>';
 
 try {
  const websitesRef = ref(database, 'websites');
  const userWebsitesQuery = query(websitesRef, orderByChild('ownerId'), equalTo(user.uid));
  const snapshot = await get(userWebsitesQuery);
  
  tbody.innerHTML = '';
  if (snapshot.exists()) {
   const websites = Object.entries(snapshot.val()).map(([id, data]) => ({ id, ...data }));
   websites.forEach(w => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
                    <td>${escapeHtml(w.name)}</td>
                    <td>${escapeHtml(w.domain)}</td>
                    <td><span class="status-badge status-${w.status}">${w.status}</span></td>
                    <td>${w.placements ? Object.keys(w.placements).length : 0}</td>
                    <td>${formatDate(w.createdAt)}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" data-id="${w.id}">Manage Placements</button>
                    </td>
                `;
    tbody.appendChild(tr);
   });
  } else {
   tbody.innerHTML = '<tr><td colspan="6" class="text-center">No websites registered.</td></tr>';
  }
 } catch (error) {
  console.error("Websites Error:", error);
 }
}

// Handle Add Website
document.addEventListener('DOMContentLoaded', () => {
 const addBtn = document.getElementById('add-website-btn');
 if (addBtn) {
  addBtn.addEventListener('click', () => {
   showModal('Register Website', `
                <div class="form-group">
                    <label>Website Name</label>
                    <input type="text" id="new-website-name" class="form-control" placeholder="My Blog">
                </div>
                <div class="form-group">
                    <label>Domain URL</label>
                    <input type="url" id="new-website-domain" class="form-control" placeholder="https://myblog.com">
                </div>
            `, [
    { label: 'Cancel', class: 'btn-secondary', onClick: (modal, close) => close() },
    {
     label: 'Register',
     class: 'btn-primary',
     onClick: async (modal, close) => {
      const name = modal.querySelector('#new-website-name').value;
      const domain = modal.querySelector('#new-website-domain').value;
      
      if (!name || !domain) return showNotification('Please fill all fields.', 'error');
      
      try {
       const websitesRef = ref(database, 'websites');
       const newRef = push(websitesRef);
       await set(newRef, {
        ownerId: auth.currentUser.uid,
        name: name,
        domain: domain,
        status: 'pending', // Needs approval
        createdAt: Date.now()
       });
       showNotification('Website registered!', 'success');
       close();
       loadWebsites();
      } catch (err) {
       showNotification('Failed to register website.', 'error');
      }
     }
    }
   ]);
  });
 }
});

onAuthStateChanged(auth, (user) => {
 if (user) loadWebsites();
});