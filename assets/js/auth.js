import { auth, database } from './firebase.js';
import {
 createUserWithEmailAndPassword,
 signInWithEmailAndPassword,
 signOut,
 onAuthStateChanged,
 sendPasswordResetEmail,
 GoogleAuthProvider, // Added Google Auth Provider
 signInWithPopup // Added Popup for Google Sign-in
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, set, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { showNotification } from './notifications.js';

// Sign Up
export async function signupUser(name, email, password) {
 try {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;
  
  // Save user profile to Realtime Database
  await set(ref(database, 'users/' + user.uid), {
   name: name,
   email: email,
   balance: 0,
   totalSpent: 0,
   totalImpressions: 0,
   totalClicks: 0,
   status: 'active',
   createdAt: Date.now()
  });
  
  showNotification('Account created successfully!', 'success');
  window.location.href = 'dashboard.html';
 } catch (error) {
  console.error("Signup Error:", error);
  showNotification(error.message, 'error');
 }
}

// Login
export async function loginUser(email, password) {
 try {
  await signInWithEmailAndPassword(auth, email, password);
  showNotification('Login successful!', 'success');
  window.location.href = 'dashboard.html';
 } catch (error) {
  console.error("Login Error:", error);
  showNotification(error.message, 'error');
 }
}

// --- NEW: Login / Sign Up with Google ---
export async function loginWithGoogle() {
 const provider = new GoogleAuthProvider();
 
 try {
  const result = await signInWithPopup(auth, provider);
  const user = result.user;
  
  // Check if the user already exists in the database
  const userRef = ref(database, 'users/' + user.uid);
  const snapshot = await get(userRef);
  
  // If they don't exist, create their profile
  if (!snapshot.exists()) {
   await set(userRef, {
    name: user.displayName || 'Google User',
    email: user.email,
    balance: 0,
    totalSpent: 0,
    totalImpressions: 0,
    totalClicks: 0,
    status: 'active',
    createdAt: Date.now()
   });
   showNotification('Google account registered successfully!', 'success');
  } else {
   showNotification('Logged in with Google!', 'success');
  }
  
  window.location.href = 'dashboard.html';
 } catch (error) {
  console.error("Google Auth Error:", error);
  showNotification(error.message, 'error');
 }
}

// Logout
export async function logoutUser() {
 try {
  await signOut(auth);
  window.location.href = 'login.html';
 } catch (error) {
  console.error("Logout Error:", error);
  showNotification('Failed to logout.', 'error');
 }
}

// Password Reset
export async function resetPassword(email) {
 try {
  await sendPasswordResetEmail(auth, email);
  showNotification('Password reset email sent!', 'success');
 } catch (error) {
  showNotification(error.message, 'error');
 }
}

// Auth State Listener
export function initAuthState() {
 onAuthStateChanged(auth, (user) => {
  const navUsername = document.getElementById('nav-username');
  const isLoginPage = window.location.pathname.endsWith('login.html');
  const isSignupPage = window.location.pathname.endsWith('signup.html');
  const isIndexPage = window.location.pathname.endsWith('index.html');
  
  if (user) {
   // User is signed in.
   if (isLoginPage || isSignupPage) {
    window.location.href = 'dashboard.html';
   }
   
   // Fetch and display username
   if (navUsername) {
    get(ref(database, 'users/' + user.uid)).then((snapshot) => {
     if (snapshot.exists()) {
      navUsername.innerText = snapshot.val().name || 'User';
     }
    }).catch(err => console.error(err));
   }
  } else {
   // User is signed out.
   if (navUsername) navUsername.innerText = 'Guest';
  }
 });
}

// Handle Global Button Listeners
document.addEventListener('DOMContentLoaded', () => {
 // Handle Logout buttons
 const logoutBtn = document.getElementById('logout-btn');
 if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
   e.preventDefault();
   logoutUser();
  });
 }
 
 // --- NEW: Handle Google Auth buttons ---
 // Any element with class "google-auth-btn" will trigger Google login
 const googleBtns = document.querySelectorAll('.google-auth-btn');
 googleBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
   e.preventDefault();
   loginWithGoogle();
  });
 });
 
 initAuthState();
});