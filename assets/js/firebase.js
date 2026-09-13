import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Your web app's Firebase configuration
const firebaseConfig = {
 apiKey: "AIzaSyDb-N96jjx1jaH1moQDEmTxO4Nam_IWDyA",
 authDomain: "maria-ad.firebaseapp.com",
 projectId: "maria-ad",
 storageBucket: "maria-ad.firebasestorage.app",
 messagingSenderId: "1006403865492",
 appId: "1:1006403865492:web:f99bca2bb02361eb70dd81",
 measurementId: "G-J6BCPZBMQZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

export { app, auth, database };