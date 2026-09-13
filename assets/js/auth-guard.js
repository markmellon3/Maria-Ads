import { auth } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export function protectRoute() {
 onAuthStateChanged(auth, (user) => {
  if (!user) {
   // User is not logged in, redirect to login
   window.location.href = 'login.html';
  }
 });
}

// Execute immediately on load
protectRoute();