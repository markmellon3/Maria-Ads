import { auth, database } from './firebase.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, set, get, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { showNotification } from './notifications.js';

// Flag to prevent race condition during signup
let isSigningUp = false;

// Sign Up
export async function signupUser(name, email, password) {
    try {
        isSigningUp = true; // Tell onAuthStateChanged to wait
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Save user profile to Realtime Database
        await set(ref(database, 'users/' + user.uid), {
            name: name,
            email: email,
            role: 'user', // <-- ADDED DEFAULT ROLE HERE
            balance: 50, // <-- AUTO $50 SIGNUP BONUS
            totalDeposited: 50, // <-- UPDATE DEPOSITED STAT
            totalSpent: 0,
            totalImpressions: 0,
            totalClicks: 0,
            status: 'active',
            createdAt: Date.now()
        });

        // Log the $50 bonus as a transaction
        const txRef = push(ref(database, 'transactions'));
        await set(txRef, {
            userId: user.uid,
            type: 'signup_bonus',
            amount: 50,
            status: 'completed',
            description: 'Sign-up bonus credit',
            createdAt: Date.now()
        });

        showNotification('Account created successfully! $50 bonus added.', 'success');
        window.location.href = 'dashboard.html'; // Now we redirect manually
    } catch (error) {
        console.error("Signup Error:", error);
        showNotification(error.message, 'error');
        isSigningUp = false; // Reset flag on error
        
        const signupBtn = document.getElementById('signup-btn');
        if (signupBtn) {
            signupBtn.innerText = 'Create Account';
            signupBtn.disabled = false;
        }
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
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.innerText = 'Login';
            loginBtn.disabled = false;
        }
    }
}

// Login / Sign Up with Google
export async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    
    try {
        isSigningUp = true;
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        const userRef = ref(database, 'users/' + user.uid);
        const snapshot = await get(userRef);

        if (!snapshot.exists()) {
            await set(userRef, {
                name: user.displayName || 'Google User',
                email: user.email,
                role: 'user', // <-- ADDED DEFAULT ROLE HERE
                balance: 50, // <-- AUTO $50 SIGNUP BONUS
                totalDeposited: 50, // <-- UPDATE DEPOSITED STAT
                totalSpent: 0,
                totalImpressions: 0,
                totalClicks: 0,
                status: 'active',
                createdAt: Date.now()
            });

            // Log the $50 bonus as a transaction
            const txRef = push(ref(database, 'transactions'));
            await set(txRef, {
                userId: user.uid,
                type: 'signup_bonus',
                amount: 50,
                status: 'completed',
                description: 'Sign-up bonus credit',
                createdAt: Date.now()
            });

            showNotification('Google account registered successfully! $50 bonus added.', 'success');
        } else {
            showNotification('Logged in with Google!', 'success');
        }

        window.location.href = 'dashboard.html';
    } catch (error) {
        console.error("Google Auth Error:", error);
        showNotification(error.message, 'error');
        isSigningUp = false;
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

        if (user) {
            // FIX: If we are in the middle of signing up, DO NOT redirect yet. 
            if ((isLoginPage || isSignupPage) && !isSigningUp) {
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

// GLOBAL EVENT LISTENERS
document.addEventListener('DOMContentLoaded', () => {
    // 1. Handle Signup Form Submission
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            
            if (password !== confirmPassword) {
                return showNotification('Passwords do not match.', 'error');
            }
            if (password.length < 6) {
                return showNotification('Password must be at least 6 characters.', 'error');
            }

            const submitBtn = document.getElementById('signup-btn');
            submitBtn.innerText = 'Creating...';
            submitBtn.disabled = true;

            await signupUser(name, email, password);
        });
    }

    // 2. Handle Login Form Submission
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            const submitBtn = document.getElementById('login-btn');
            submitBtn.innerText = 'Logging in...';
            submitBtn.disabled = true;

            await loginUser(email, password);
        });
    }

    // 3. Handle Logout buttons
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }

    // 4. Handle Google Auth buttons
    const googleBtns = document.querySelectorAll('.google-auth-btn');
    googleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            loginWithGoogle();
        });
    });

    // 5. Handle Forgot Password link
    const forgotPasswordLink = document.getElementById('forgot-password');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const emailInput = document.getElementById('email');
            if (emailInput && emailInput.value) {
                await resetPassword(emailInput.value);
            } else {
                showNotification('Please enter your email above first.', 'warning');
            }
        });
    }

    // Initialize auth state listener
    initAuthState();
}); 
