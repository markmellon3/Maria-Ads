import { auth, database } from './firebase.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { showNotification } from './notifications.js';
import { showModal } from './modal.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

async function loadSettings() {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const snapshot = await get(ref(database, 'users/' + user.uid + '/settings'));
        if (snapshot.exists()) {
            const settings = snapshot.val();
            document.getElementById('notify-email').checked = settings.notifyEmail || false;
            document.getElementById('notify-low-balance').checked = settings.notifyLowBalance || false;
        }
    } catch (error) {
        console.error("Settings load error:", error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Save Settings
    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const settings = {
                notifyEmail: document.getElementById('notify-email').checked,
                notifyLowBalance: document.getElementById('notify-low-balance').checked
            };
            try {
                await update(ref(database, 'users/' + auth.currentUser.uid), { settings });
                showNotification('Settings saved!', 'success');
            } catch (error) {
                showNotification('Failed to save settings.', 'error');
            }
        });
    }

    // Change Password (Mock Modal)
    const changePassBtn = document.getElementById('change-password-btn');
    if (changePassBtn) {
        changePassBtn.addEventListener('click', () => {
            showModal('Change Password', `<p>Password reset email will be sent to your registered email address.</p>`, [
                { label: 'Cancel', class: 'btn-secondary', onClick: (m, c) => c() },
                { 
                    label: 'Send Email', 
                    class: 'btn-primary', 
                    onClick: async (m, c) => {
                        // Importing auth function directly for simplicity here
                        const { sendPasswordResetEmail } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
                        sendPasswordResetEmail(auth, auth.currentUser.email)
                            .then(() => { showNotification('Email sent!', 'success'); c(); })
                            .catch(() => showNotification('Error sending email.', 'error'));
                    }
                }
            ]);
        });
    }

    // Delete Account Request
    const deleteBtn = document.getElementById('delete-account-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            showModal('Delete Account', `
                <p class="text-danger">Warning: This will mark your account for deletion. You will lose access to your campaigns.</p>
                <p>To confirm, type "DELETE" below:</p>
                <input type="text" id="delete-confirm-input" class="form-control">
            `, [
                { label: 'Cancel', class: 'btn-secondary', onClick: (m, c) => c() },
                {
                    label: 'Delete Permanently',
                    class: 'btn-danger',
                    onClick: async (m, c) => {
                        const confirmText = m.querySelector('#delete-confirm-input').value;
                        if (confirmText === 'DELETE') {
                            try {
                                // Mark for deletion instead of actually deleting from client side for safety
                                await update(ref(database, 'users/' + auth.currentUser.uid), { status: 'deletion_requested' });
                                showNotification('Account marked for deletion. Logging out...', 'warning');
                                setTimeout(() => {
                                    import('./auth.js').then(mod => mod.logoutUser());
                                }, 2000);
                            } catch (err) {
                                showNotification('Failed to process request.', 'error');
                            }
                        } else {
                            showNotification('Confirmation text does not match.', 'error');
                        }
                    }
                }
            ]);
        });
    }
});

onAuthStateChanged(auth, (user) => {
    if (user) loadSettings();
});