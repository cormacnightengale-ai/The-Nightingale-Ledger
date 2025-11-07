import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithCustomToken, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firestore log level to Debug for better visibility
setLogLevel('Debug');

// --- Global Variables (Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : (window.firebaseConfig || {});
// NOTE: __initial_auth_token is no longer used for primary sign-in, as requested.
// const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let userSlot = null; // 'nightingale' or 'keeper'
let authMode = 'signIn'; // 'signIn' or 'signUp'

const GAME_STATE_DOC_PATH = `artifacts/${appId}/public/data/ledger_state/ledger_data`; 
const GAME_STATE_DOC_ID = 'ledger_data';

// --- Undo State ---
let lastDeletedItem = null;
let lastDeletedCollection = null;
let lastDeletedIndex = null;
let toastTimeout = null;

const defaultProfile = {
    name: 'New Partner',
    avatarUrl: '', 
    status: 'Neutral',
    slot: null 
};

const defaultGameState = {
    nightingaleScore: 0,
    keeperScore: 0,
    authorizedUsers: [], 
    profiles: {},        
    habits: [], 
    rewards: [],
    punishments: [],
};

let gameState = { ...defaultGameState }; 

// --- Core Ledger Data Management (Authentication, Initialization, Listener) ---

/**
 * Utility to display errors on the authentication modal.
 */
function showAuthError(message) {
    document.getElementById('auth-error-message-modal').textContent = message;
    setTimeout(() => document.getElementById('auth-error-message-modal').textContent = '', 5000);
}

/**
 * Hides the main app content and displays the authentication modal.
 */
function showAuthModal() {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('app-content').classList.add('hidden');
    document.getElementById('auth-modal').classList.remove('hidden');
    showAuthError(''); // Clear previous error
}

/**
 * Toggles between sign-in and sign-up mode in the auth modal.
 */
window.toggleAuthMode = function() {
    authMode = authMode === 'signIn' ? 'signUp' : 'signIn';
    const title = document.getElementById('auth-header-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleBtn = document.getElementById('auth-toggle-btn');
    
    if (authMode === 'signUp') {
        title.textContent = 'Create a New Account';
        submitBtn.textContent = 'Sign Up';
        toggleBtn.textContent = 'Have an account? Sign In';
    } else {
        title.textContent = 'Sign In to Continue';
        submitBtn.textContent = 'Sign In';
        toggleBtn.textContent = 'New User? Create an Account';
    }
    showAuthError('');
}

/**
 * Handles the submission of the Email/Password form based on current authMode.
 */
window.handleEmailAuth = async function(event) {
    event.preventDefault();
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    
    try {
        if (authMode === 'signIn') {
            await signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged will handle the rest
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged will handle the rest
        }
    } catch (error) {
        let message = "An unknown error occurred.";
        if (error.code === 'auth/wrong-password') message = "Invalid password.";
        else if (error.code === 'auth/user-not-found') message = "No user found with this email.";
        else if (error.code === 'auth/email-already-in-use') message = "Email already in use. Try signing in.";
        else if (error.code === 'auth/weak-password') message = "Password should be at least 6 characters.";
        else if (error.code === 'auth/invalid-email') message = "Invalid email format.";
        
        showAuthError(`Error: ${message}`);
        console.error("Auth Error:", error);
    }
}

/**
 * Handles Google Sign-In using a popup.
 */
window.signInGoogle = async function() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        // onAuthStateChanged will handle the rest
    } catch (error) {
        if (error.code === 'auth/popup-closed-by-user') return;
        showAuthError("Google Sign-in failed. Try email/password or check console.");
        console.error("Google Auth Error:", error);
    }
}

/**
 * Initializes Firebase, sets up auth listener, and determines initial UI state.
 */
async function initializeAppAndAuth() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // 1. Auth State Change Listener (Central control)
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                console.log(`User authenticated with ID: ${userId}.`);
                document.getElementById('auth-modal').classList.add('hidden');
                document.getElementById('app-content').classList.remove('hidden');
                document.getElementById('current-user-id').textContent = userId;
                setupLedgerListener(user);
            } else {
                userId = null;
                showAuthModal(); // Show the login screen
            }
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        document.getElementById('loading-message').textContent = `Initialization Error: ${error.message}`;
    }
}

/**
 * Sets up a real-time listener for the shared ledger data and manages the two-user lock.
 */
function setupLedgerListener(user) {
    const docRef = doc(db, GAME_STATE_DOC_PATH);

    onSnapshot(docRef, async (docSnapshot) => {
        
        // Use the authenticated user's ID
        const currentUserId = user.uid;

        if (docSnapshot.exists()) {
            const remoteState = docSnapshot.data();
            gameState = { ...defaultGameState, ...remoteState };
            
            let users = gameState.authorizedUsers || [];
            let profiles = gameState.profiles || {};
            
            const isAuthorized = users.includes(currentUserId);
            let requiresUpdate = false;
            
            if (!isAuthorized) {
                if (users.length < 2) {
                    // Assign new authenticated user to an empty slot
                    users = [...users, currentUserId];
                    const slot = users.length === 1 ? 'nightingale' : 'keeper';
                    const name = user.displayName || user.email || slot.charAt(0).toUpperCase() + slot.slice(1);
                    const newProfile = { ...defaultProfile, name: name.split('@')[0], slot: slot };
                    profiles[currentUserId] = newProfile;
                    
                    userSlot = slot;
                    requiresUpdate = true;
                } else {
                    // This is the error the user was seeing. Now it happens only to the 3rd authenticated user.
                    // We sign out the user to force them back to the login screen without persistent data.
                    showAuthError(`The ledger is currently locked to two authorized users. Your User ID is not permitted.`);
                    await signOut(auth); 
                    return; 
                }
            } else {
                // User is authorized, ensure profile data exists and slot is set
                if (!profiles[currentUserId]) {
                    // This should not happen if the initial sign-up logic works, but provides a fallback
                    userSlot = users.length === 1 ? 'nightingale' : (users[0] === currentUserId ? 'nightingale' : 'keeper');
                    const name = user.displayName || user.email || userSlot.charAt(0).toUpperCase() + userSlot.slice(1);
                    profiles[currentUserId] = { ...defaultProfile, name: name.split('@')[0], slot: userSlot };
                    requiresUpdate = true;
                } else {
                    userSlot = profiles[currentUserId].slot;
                }
            }

            if (requiresUpdate) {
                await updateDoc(docRef, { authorizedUsers: users, profiles: profiles });
            }

            renderLedger();
            // Show main app content (handled by onAuthStateChanged)

        } else {
            // Document does not exist, create the initial document with current user as Nightingale
            const initialSlot = 'nightingale';
            const name = user.displayName || user.email || 'Nightingale';
            const initialProfile = { ...defaultProfile, name: name.split('@')[0], slot: initialSlot };
            
            gameState.authorizedUsers = [currentUserId];
            gameState.profiles[currentUserId] = initialProfile;
            userSlot = initialSlot;
            
            await setDoc(docRef, gameState)
                .then(() => console.log("Default ledger state created successfully."))
                .catch((error) => console.error("Error creating default ledger state:", error));
        }
    }, (error) => {
        console.error("Firestore Listener Error:", error);
        document.getElementById('auth-error-message').textContent = `Data Error: Could not load ledger. ${error.message}`;
        showAuthModal();
    });
}


/**
 * Updates the entire gameState document in Firestore.
 */
async function updateGameState(updates) {
    if (!db) {
        console.error("Database not initialized.");
        return;
    }
    const docRef = doc(db, GAME_STATE_DOC_PATH);
    try {
        await updateDoc(docRef, updates);
    } catch (error) {
        if (error.code === 'not-found') {
             await setDoc(docRef, { ...gameState, ...updates });
        } else {
            console.error("Error updating game state:", error);
        }
    }
}

// --- Rendering Functions (Simplified for brevity) ---
function renderLedger() {
    
    // Find which user is assigned to which slot based on the profile data
    const nightingaleUser = gameState.authorizedUsers.find(uid => gameState.profiles[uid]?.slot === 'nightingale');
    const keeperUser = gameState.authorizedUsers.find(uid => gameState.profiles[uid]?.slot === 'keeper');

    const nightingaleProfile = nightingaleUser ? gameState.profiles[nightingaleUser] : { ...defaultProfile, name: 'Nightingale', slot: 'nightingale' };
    const keeperProfile = keeperUser ? gameState.profiles[keeperUser] : { ...defaultProfile, name: 'Keeper', slot: 'keeper' };

    // 1. Update Scoreboard Names, Avatars, Statuses and Scores
    
    // Nightingale
    document.getElementById('nightingale-name-display').textContent = nightingaleProfile.name;
    document.getElementById('nightingale-status-display').textContent = nightingaleProfile.status;
    document.getElementById('nightingale-score').textContent = gameState.nightingaleScore || 0;
    document.getElementById('nightingale-avatar').src = nightingaleProfile.avatarUrl || `https://placehold.co/48x48/B05C6C/ffffff?text=${nightingaleProfile.name.charAt(0)}`;
    
    // Keeper
    document.getElementById('keeper-name-display').textContent = keeperProfile.name;
    document.getElementById('keeper-status-display').textContent = keeperProfile.status;
    document.getElementById('keeper-score').textContent = gameState.keeperScore || 0;
    document.getElementById('keeper-avatar').src = keeperProfile.avatarUrl || `https://placehold.co/48x48/5C8CB0/ffffff?text=${keeperProfile.name.charAt(0)}`;

    // Update forms with current names
    const nightingaleOption = document.querySelector('#new-habit-type option[value="nightingale"]');
    if (nightingaleOption) nightingaleOption.textContent = nightingaleProfile.name;
    
    const keeperOption = document.querySelector('#new-habit-type option[value="keeper"]');
    if (keeperOption) keeperOption.textContent = keeperProfile.name;

    // 2. Render lists
    renderHabits(nightingaleProfile, keeperProfile);
    renderRewards();
    renderPunishments();
}

/**
 * Renders the Habit list, now including repeat information.
 */
function renderHabits(nightingaleProfile, keeperProfile) {
    const listEl = document.getElementById('habits-list');
    const habits = gameState.habits || [];
    
    if (habits.length === 0) {
        listEl.innerHTML = '<p class="p-4 text-center text-gray-500">No habits defined yet. Use the "Add New Habit" button above!</p>';
        return;
    }

    listEl.innerHTML = habits.map((habit, index) => {
        const isNightingale = habit.type === 'nightingale';
        const playerClass = isNightingale ? 'text-nightingale' : 'text-keeper';
        const playerLabel = isNightingale ? nightingaleProfile.name : keeperProfile.name;
        const repeatLabel = habit.repeat.charAt(0).toUpperCase() + habit.repeat.slice(1);

        return `
            <div class="list-item">
                <div class="flex-1 min-w-0 pr-4">
                    <p class="text-lg text-gray-200 truncate" title="${habit.description}">${habit.description}</p>
                    <p class="text-xs text-gray-500">
                        <span class="${playerClass} font-bold">${playerLabel}</span> | 
                        <span class="text-white">${repeatLabel}</span> |
                        <span class="text-sm font-semibold text-white">${habit.points} Points</span>
                    </p>
                </div>
                <div class="flex space-x-2 items-center">
                    <button onclick="window.completeHabit('${index}')" class="btn-primary text-sm bg-green-700 hover:bg-green-600 p-2 leading-none" title="Complete Habit">
                        <i class="fas fa-check"></i>
                    </button>
                    <button onclick="window.prepareDelete('habits', '${index}')" class="text-gray-500 hover:text-error text-xl" title="Delete Habit">
                        &times;
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderRewards() {
    const listEl = document.getElementById('rewards-list');
    const rewards = gameState.rewards || [];

    if (rewards.length === 0) {
        listEl.innerHTML = '<p class="p-4 text-center text-gray-500">No rewards defined yet. Time to add some incentives!</p>';
        return;
    }

    listEl.innerHTML = rewards.map((reward, index) => `
        <div class="list-item">
            <div class="flex-1 min-w-0 pr-4">
                <p class="text-lg font-cinzel text-nightingale truncate" title="${reward.title}">${reward.title}</p>
                <p class="text-xs text-gray-500 truncate" title="${reward.description}">${reward.description}</p>
            </div>
            <div class="flex space-x-2 items-center">
                <div class="text-sm font-bold text-yellow-400 mr-2">${reward.cost} Points</div>
                <button onclick="window.claimReward('${index}', ${reward.cost})" class="btn-primary text-sm bg-yellow-600 hover:bg-yellow-500 p-2 leading-none" title="Claim Reward">
                    <i class="fas fa-hand-holding-usd"></i>
                </button>
                <button onclick="window.prepareDelete('rewards', '${index}')" class="text-gray-500 hover:text-error text-xl" title="Delete Reward">
                    &times;
                </button>
            </div>
        </div>
    `).join('');
}

function renderPunishments() {
    const listEl = document.getElementById('punishments-list');
    const punishments = gameState.punishments || [];

    if (punishments.length === 0) {
        listEl.innerHTML = '<p class="p-4 text-center text-gray-500">No punishments defined yet. You\'re living on the edge!</p>';
        return;
    }

    listEl.innerHTML = punishments.map((punishment, index) => `
        <div class="list-item">
            <div class="flex-1 min-w-0 pr-4">
                <p class="text-lg font-cinzel text-keeper truncate" title="${punishment.title}">${punishment.title}</p>
                <p class="text-xs text-gray-500 truncate" title="${punishment.description}">${punishment.description}</p>
            </div>
            <div class="flex space-x-2 items-center">
                <button onclick="window.prepareDelete('punishments', '${index}')" class="text-gray-500 hover:text-error text-xl" title="Remove Punishment">
                    &times;
                </button>
            </div>
        </div>
    `).join('');
}

// --- Toast and Undo Logic (New) ---

/**
 * Displays a toast notification with an optional undo button.
 */
function showToast(message, action) {
    const container = document.getElementById('toast-container');
    container.innerHTML = ''; // Clear existing toast

    const toastEl = document.createElement('div');
    toastEl.className = 'flex items-center justify-between bg-gray-800 text-white p-3 rounded-lg shadow-xl border border-gray-700 animate-fadeIn';
    toastEl.style.animation = 'fadeIn 0.3s ease-in-out';
    toastEl.innerHTML = `
        <span class="text-sm">${message}</span>
        ${action ? `<button onclick="window.undoLastAction()" class="ml-4 px-3 py-1 bg-[#b05c6c] hover:bg-[#c06c7c] rounded-md text-sm font-semibold transition-colors">Undo</button>` : ''}
    `;
    
    // Define simple fade-in keyframes (Tailwind doesn't have a default for this precise use)
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`;
    document.head.appendChild(styleEl);

    container.appendChild(toastEl);

    // Clear previous timeout and set a new one
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toastEl.remove();
        lastDeletedItem = null;
        lastDeletedCollection = null;
        lastDeletedIndex = null;
    }, 5000); // Toast disappears after 5 seconds
}

/**
 * Reverses the last deletion operation.
 */
window.undoLastAction = async function() {
    if (!lastDeletedItem || !lastDeletedCollection) {
        showToast("Nothing to undo.", false);
        return;
    }

    const collection = [...gameState[lastDeletedCollection]];
    // Insert the deleted item back into its original index
    collection.splice(lastDeletedIndex, 0, lastDeletedItem);

    const updates = { [lastDeletedCollection]: collection };
    await updateGameState(updates);

    // Clear the undo state and the toast
    document.getElementById('toast-container').innerHTML = '';
    clearTimeout(toastTimeout);
    
    showToast(`${lastDeletedItem.title || lastDeletedItem.description} restored.`, false);

    lastDeletedItem = null;
    lastDeletedCollection = null;
    lastDeletedIndex = null;
}

// --- Profile & Customization Functions ---

window.toggleEditProfileModal = function(show) {
    document.getElementById('edit-profile-modal').classList.toggle('hidden', !show);
}

/**
 * Pre-populates the Edit Profile Modal with the target user's data and opens it.
 */
window.openEditProfile = function(slot) {
    // Determine the userId associated with the clicked slot
    const targetUserId = gameState.authorizedUsers.find(uid => gameState.profiles[uid]?.slot === slot);
    
    // Only allow editing if the current user ID matches the target slot's ID
    if (userId !== targetUserId) {
        document.getElementById('auth-error-message').textContent = `ERROR: You can only edit your own profile, not the ${slot.charAt(0).toUpperCase() + slot.slice(1)} profile.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
        return;
    }

    const currentProfile = gameState.profiles[userId] || defaultProfile;

    // Use hidden fields to store which user ID/slot is being edited
    document.getElementById('edit-profile-slot').value = slot; 
    document.getElementById('edit-profile-user-id').value = userId; 

    document.getElementById('edit-profile-name').value = currentProfile.name;
    document.getElementById('edit-avatar-url').value = currentProfile.avatarUrl;
    document.getElementById('edit-status').value = currentProfile.status;

    window.toggleEditProfileModal(true);
}

/**
 * Saves changes from the Edit Profile Modal to Firestore.
 */
window.saveProfileChanges = async function(event) {
    event.preventDefault();

    const targetUserId = document.getElementById('edit-profile-user-id').value;

    if (userId !== targetUserId) {
        document.getElementById('auth-error-message').textContent = `Authentication mismatch: Cannot save profile for another user.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
        return;
    }

    const newName = document.getElementById('edit-profile-name').value.trim();
    const newAvatarUrl = document.getElementById('edit-avatar-url').value.trim();
    const newStatus = document.getElementById('edit-status').value;

    if (!newName) {
        document.getElementById('auth-error-message').textContent = `Name cannot be empty.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 3000);
        return;
    }

    const updatedProfile = {
        ...gameState.profiles[userId],
        name: newName,
        avatarUrl: newAvatarUrl,
        status: newStatus
    };
    
    const updates = { 
        profiles: {
            ...gameState.profiles,
            [userId]: updatedProfile
        }
    };

    await updateGameState(updates);
    showToast(`Profile for ${newName} saved successfully!`, false);
    window.toggleEditProfileModal(false);
}

// --- Utility & Administrative Functions ---

window.toggleSettingsPanel = function(show) {
    const panel = document.getElementById('settings-panel');
    panel.classList.toggle('hidden', !show);
    if (show) {
        panel.scrollIntoView({ behavior: 'smooth' });
    }
}

window.resetLedger = async function() {
    document.getElementById('auth-error-message').textContent = "ARE YOU SURE? Click 'Reset All Ledger Data' again within 5 seconds to confirm permanent reset.";
    setTimeout(() => {
        if (document.getElementById('auth-error-message').textContent.includes("confirm permanent reset")) {
            document.getElementById('auth-error-message').textContent = "";
        }
    }, 5000);
    
    const confirmationButton = document.querySelector('#settings-panel button.bg-red-500');
    
    const confirmReset = async () => {
        if (document.getElementById('auth-error-message').textContent.includes("confirm permanent reset")) {
            confirmationButton.removeEventListener('click', confirmReset);

            const resetState = { 
                ...defaultGameState, 
                // Keep the authorized users and re-initialize their profiles
                authorizedUsers: gameState.authorizedUsers, 
                profiles: gameState.authorizedUsers.reduce((acc, uid) => {
                    const slot = gameState.profiles[uid]?.slot || (uid === gameState.authorizedUsers[0] ? 'nightingale' : 'keeper');
                    acc[uid] = { ...defaultProfile, name: slot.charAt(0).toUpperCase() + slot.slice(1), slot: slot };
                    return acc;
                }, {})
            };

            const docRef = doc(db, GAME_STATE_DOC_PATH);
            try {
                await setDoc(docRef, resetState);
                showToast("Ledger successfully reset!", false);
            } catch (error) {
                console.error("Error resetting ledger:", error);
                document.getElementById('auth-error-message').textContent = `Error resetting ledger: ${error.message}`;
            }
            window.toggleSettingsPanel(false);
        }
    };
    
    confirmationButton.addEventListener('click', confirmReset, { once: true });
}

window.signOutUser = async function() {
    try {
        await signOut(auth);
        // The onAuthStateChanged listener will catch this and show the auth modal
        document.getElementById('app-content').classList.add('hidden');
        document.getElementById('auth-error-message').textContent = "Signed out successfully.";
    } catch (error) {
        console.error("Sign Out Error:", error);
        document.getElementById('auth-error-message').textContent = `Sign Out Error: ${error.message}`;
    }
}

// --- Action Functions (Unchanged) ---

window.toggleHabitForm = function(show) { document.getElementById('habit-form').classList.toggle('hidden', !show); }
window.toggleRewardForm = function(show) { document.getElementById('reward-form').classList.toggle('hidden', !show); }
window.togglePunishmentForm = function(show) { document.getElementById('punishment-form').classList.toggle('hidden', !show); }

window.completeHabit = async function(index) {
    const habits = [...gameState.habits];
    const completedHabit = habits.splice(index, 1)[0];
    
    if (!completedHabit) return;

    let updates = { habits: habits };

    if (completedHabit.type === 'nightingale') {
        updates.nightingaleScore = (gameState.nightingaleScore || 0) + completedHabit.points;
    } else if (completedHabit.type === 'keeper') {
        updates.keeperScore = (gameState.keeperScore || 0) + completedHabit.points;
    }
    
    // If the habit is not 'one-time', re-add it to the end of the list after completion
    if (completedHabit.repeat !== 'one-time') {
         updates.habits = [...updates.habits, completedHabit];
    }


    await updateGameState(updates);
    showToast(`${completedHabit.description} completed! +${completedHabit.points} points.`, false);
}

window.claimReward = async function(index, cost) {
    const totalScore = (gameState.nightingaleScore || 0) + (gameState.keeperScore || 0);
    if (totalScore < cost) {
        document.getElementById('auth-error-message').textContent = `ERROR: Not enough total points. Need ${cost}.`;
        setTimeout(() => document.getElementById('auth-error-message').textContent = '', 4000);
        return;
    }
    
    let nightingaleDeduction = Math.min(cost, gameState.nightingaleScore);
    let keeperDeduction = cost - nightingaleDeduction;

    let updates = {
        nightingaleScore: gameState.nightingaleScore - nightingaleDeduction,
        keeperScore: gameState.keeperScore - keeperDeduction
    };
    
    // Prepare for deletion
    window.prepareDelete('rewards', index);

    await updateGameState(updates);
    showToast(`Reward claimed! -${cost} points.`, false);
}

// --- Creation/Deletion/Example Functions (Omitted for brevity, assumed to be correctly structured) ---

window.saveNewHabit = async function(event) {
    event.preventDefault();
    const newHabit = {
        description: document.getElementById('new-habit-desc').value.trim(),
        points: parseInt(document.getElementById('new-habit-points').value, 10),
        type: document.getElementById('new-habit-type').value,
        repeat: document.getElementById('new-habit-repeat').value, 
        id: crypto.randomUUID(),
    };

    if (newHabit.description && newHabit.points > 0) {
        const habits = [...gameState.habits, newHabit];
        await updateGameState({ habits });
        document.getElementById('new-habit-form').reset();
        window.toggleHabitForm(false);
    }
}

window.saveNewReward = async function(event) {
    event.preventDefault();
    const newReward = {
        title: document.getElementById('new-reward-title').value.trim(),
        cost: parseInt(document.getElementById('new-reward-cost').value, 10),
        description: document.getElementById('new-reward-desc').value.trim(),
        id: crypto.randomUUID(),
    };

    if (newReward.title && newReward.cost > 0) {
        const rewards = [...gameState.rewards, newReward];
        await updateGameState({ rewards });
        document.getElementById('new-reward-form').reset();
        window.toggleRewardForm(false);
    }
}

window.saveNewPunishment = async function(event) {
    event.preventDefault();
    const newPunishment = {
        title: document.getElementById('new-punishment-title').value.trim(),
        description: document.getElementById('new-punishment-desc').value.trim(),
        id: crypto.randomUUID(),
    };

    if (newPunishment.title && newPunishment.description) {
        const punishments = [...gameState.punishments, newPunishment];
        await updateGameState({ punishments });
        document.getElementById('new-punishment-form').reset();
        window.togglePunishmentForm(false);
    }
}

window.prepareDelete = async function(collectionName, index) {
    const list = [...gameState[collectionName]];
    const i = parseInt(index, 10);
    
    if (i >= list.length || i < 0) return;

    lastDeletedItem = list.splice(i, 1)[0];
    lastDeletedCollection = collectionName;
    lastDeletedIndex = i;

    const updates = { [collectionName]: list };
    await updateGameState(updates);

    const name = lastDeletedItem.title || lastDeletedItem.description;
    showToast(`"${name}" deleted.`, true);
}


window.fillHabitForm = function() {
    if (!window.EXAMPLE_DATABASE) { 
        console.error("Example database not loaded.");
        return; 
    }
    const examples = EXAMPLE_DATABASE.habits;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-habit-desc').value = example.description;
    document.getElementById('new-habit-points').value = example.points;
    document.getElementById('new-habit-type').value = example.type;
    document.getElementById('new-habit-repeat').value = 'daily'; 
    if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleHabitForm(true); }
}

window.fillRewardForm = function() {
    if (!window.EXAMPLE_DATABASE) { 
        console.error("Example database not loaded.");
        return; 
    }
    const examples = EXAMPLE_DATABASE.rewards;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-reward-title').value = example.title;
    document.getElementById('new-reward-cost').value = example.cost;
    document.getElementById('new-reward-desc').value = example.description;
    if (document.getElementById('reward-form').classList.contains('hidden')) { window.toggleRewardForm(true); }
}

window.fillPunishmentForm = function() {
    if (!window.EXAMPLE_DATABASE) { 
        console.error("Example database not loaded.");
        return; 
    }
    const examples = EXAMPLE_DATABASE.punishments;
    if (examples.length === 0) return;
    const example = examples[Math.floor(Math.random() * examples.length)];
    document.getElementById('new-punishment-title').value = example.title;
    document.getElementById('new-punishment-desc').value = example.description;
    if (document.getElementById('punishment-form').classList.contains('hidden')) { window.togglePunishmentForm(true); }
}

// --- Initialization ---

window.onload = initializeAppAndAuth;