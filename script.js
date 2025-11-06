import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---
// Note: EXAMPLE_DATABASE is expected to be loaded via examples.js first.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let GAME_STATE_PATH = null;
const GAME_STATE_DOC_ID = 'ledger_data';
let gameState = {
    players: {
        keeper: 'User 1',
        nightingale: 'User 2'
    },
    scores: {
        keeper: 0,
        nightingale: 0
    },
    habits: [],
    rewards: [],
    punishments: [],
    lastAction: null,
    lastActionTimestamp: 0, // For undo functionality
    lastDeletedItemId: null,
    lastDeletedItemCollection: null,
};

// --- Utility Functions ---

/**
 * Simple UUID generator for unique item IDs.
 * @returns {string}
 */
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Displays a custom modal message.
 * @param {string} title - The modal title.
 * @param {string} message - The modal body message.
 * @param {Array<Object>} buttons - Array of button configs: [{ text, class, action (optional) }]
 */
function showModal(title, message, buttons = [{ text: 'OK', class: 'btn-primary', action: 'close' }]) {
    const modalContainer = document.getElementById('modal-container');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    
    const actionsDiv = document.getElementById('modal-actions');
    actionsDiv.innerHTML = ''; 

    buttons.forEach(btn => {
        const buttonElement = document.createElement('button');
        buttonElement.textContent = btn.text;
        buttonElement.className = `${btn.class} rounded-lg font-sans font-semibold flex-1`;
        if (btn.action === 'close') {
            buttonElement.onclick = () => {
                modalContainer.classList.add('hidden');
            };
        } else if (typeof btn.action === 'function') {
            buttonElement.onclick = () => {
                btn.action();
                modalContainer.classList.add('hidden');
            };
        }
        actionsDiv.appendChild(buttonElement);
    });

    modalContainer.classList.remove('hidden');
}

/**
 * Displays an error message in a modal.
 * @param {Error} e - The error object.
 * @param {string} context
 */
function handleError(e, context = "An unknown error occurred") {
    console.error(`[Nightingale Ledger Error] ${context}:`, e);
    showModal("System Error", `${context}. Please check the console for details.`, [
        { text: "Dismiss", class: "btn-secondary", action: 'close' }
    ]);
}

/**
 * Displays a toast notification (for non-critical feedback with undo).
 * @param {string} message - The message to display.
 * @param {boolean} showUndo - Whether to show the undo button.
 */
function showToast(message, showUndo = false) {
    const toast = document.getElementById('toast-notification');
    document.getElementById('toast-message').textContent = message;
    document.getElementById('toast-undo-btn').style.display = showUndo ? 'block' : 'none';
    
    toast.classList.remove('opacity-0', 'pointer-events-none');
    toast.classList.add('opacity-100');

    // Hide after 5 seconds if not interacted with
    if (window.toastTimer) clearTimeout(window.toastTimer);
    if (!showUndo) {
        window.toastTimer = setTimeout(() => {
            toast.classList.remove('opacity-100');
            toast.classList.add('opacity-0', 'pointer-events-none');
        }, 5000);
    }
}

/**
 * Hides the toast notification.
 */
function hideToast() {
    const toast = document.getElementById('toast-notification');
    if (window.toastTimer) clearTimeout(window.toastTimer);
    toast.classList.remove('opacity-100');
    toast.classList.add('opacity-0', 'pointer-events-none');
}

/**
 * Generates a random Ledger Code (6 Alphanumeric characters).
 * @returns {string}
 */
function generateLedgerCode() {
    return Array(6).fill(0).map(() => 
        (Math.random() * 36 | 0).toString(36)
    ).join('').toUpperCase();
}


// --- Firebase Initialization and Auth ---

/**
 * 1. Initializes Firebase app, auth, and firestore services.
 * 2. Attempts to sign in using the custom token, or anonymously if not available.
 * 3. Sets up the auth state listener to proceed to ledger selection.
 */
async function initializeFirebase() {
    if (!firebaseConfig) {
        handleError(new Error("Firebase config missing"), "Cannot initialize Firebase");
        return;
    }
    
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Log the application ID
        document.getElementById('current-app-id').textContent = appId;

        // Sign in using custom token or anonymously
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        
        // Listen for Auth State Changes
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('current-user-id').textContent = userId;
                
                // Once authenticated, check for an existing ledger selection
                checkForExistingLedger();
            } else {
                // User is signed out (should not happen in this environment)
                userId = null;
                document.getElementById('current-user-id').textContent = 'Signed Out';
                document.getElementById('auth-loading').classList.add('hidden');
            }
        });

    } catch (e) {
        handleError(e, "Firebase Setup Failed");
    }
}

/**
 * Checks if the user has previously selected a ledger code.
 */
async function checkForExistingLedger() {
    const userRef = doc(db, 'artifacts', appId, 'users', userId);
    
    try {
        const docSnap = await getDoc(userRef);
        document.getElementById('auth-loading').classList.add('hidden');
        document.getElementById('selection-options').classList.remove('hidden');

        if (docSnap.exists() && docSnap.data().ledgerCode) {
            const ledgerCode = docSnap.data().ledgerCode;
            GAME_STATE_PATH = `artifacts/${appId}/public/data/${ledgerCode}`;
            document.getElementById('ledger-selection-modal').classList.add('hidden');
            document.getElementById('main-content').classList.remove('hidden');
            document.getElementById('current-ledger-code').textContent = ledgerCode;
            startLedgerListener();
            return;
        }

    } catch (e) {
        handleError(e, "Failed to retrieve user's ledger preference");
    }
}

// --- Ledger Selection & Management ---

/**
 * Sets the ledger code and updates the user's private data.
 * @param {string} code - The 6-digit ledger code.
 */
async function selectLedger(code) {
    const userRef = doc(db, 'artifacts', appId, 'users', userId);
    GAME_STATE_PATH = `artifacts/${appId}/public/data/${code}`;
    
    try {
        await setDoc(userRef, { ledgerCode: code }, { merge: true });
        
        document.getElementById('current-ledger-code').textContent = code;
        document.getElementById('ledger-selection-modal').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        
        startLedgerListener();
        
        return true;
    } catch (e) {
        handleError(e, "Failed to save ledger preference");
        return false;
    }
}

/**
 * Host a new ledger.
 */
window.hostNewLedger = async function() {
    const newCode = generateLedgerCode();
    const ledgerRef = doc(db, `artifacts/${appId}/public/data/${newCode}`, GAME_STATE_DOC_ID);
    
    try {
        // Check if a ledger with this code already exists (unlikely but possible)
        const docSnap = await getDoc(ledgerRef);
        if (docSnap.exists()) {
            showModal("Code Conflict", "A ledger with this code already exists. Please try hosting again.");
            return;
        }

        // Initialize the new shared document
        const initialData = {
            ...gameState,
            ledgerCode: newCode,
            createdAt: new Date().toISOString()
        };

        await setDoc(ledgerRef, initialData);
        await selectLedger(newCode);
        showNameConfigModal(); // Force name setup on new ledger
        showModal("Ledger Hosted!", `Your new Ledger Code is: ${newCode}. Share this code with your partner!`);

    } catch (e) {
        handleError(e, "Failed to host new ledger");
    }
}

/**
 * Join an existing ledger.
 */
window.joinExistingLedger = async function() {
    const input = document.getElementById('join-code-input');
    const code = input.value.trim().toUpperCase();

    if (code.length !== 6) {
        showModal("Invalid Code", "Ledger Code must be exactly 6 characters.");
        return;
    }

    const ledgerRef = doc(db, `artifacts/${appId}/public/data/${code}`, GAME_STATE_DOC_ID);

    try {
        const docSnap = await getDoc(ledgerRef);
        if (!docSnap.exists()) {
            showModal("Not Found", `No active ledger found with code: ${code}. Please check the code and try again.`);
            return;
        }

        // Ledger exists, join it
        await selectLedger(code);
        showModal("Ledger Joined!", `You have successfully joined Ledger ${code}.`);

    } catch (e) {
        handleError(e, "Failed to join ledger");
    }
}


// --- Real-time Listener ---

/**
 * Sets up the real-time listener for the shared ledger document.
 */
function startLedgerListener() {
    if (!GAME_STATE_PATH || !db) return;
    
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            gameState = docSnap.data();
            renderUI();
        } else {
            // Should only happen if the document is deleted by an external party
            console.warn("Ledger document no longer exists.");
            showModal("Ledger Removed", "The shared ledger has been disconnected or deleted.");
            document.getElementById('main-content').classList.add('hidden');
            document.getElementById('ledger-selection-modal').classList.remove('hidden');
        }
    }, (error) => {
        handleError(error, "Real-time sync failed");
    });
}


// --- UI Rendering ---

/**
 * Renders the entire UI based on the current gameState.
 */
function renderUI() {
    // 1. Scores and Names
    document.getElementById('player1-name-display').textContent = `${gameState.players.keeper} (Keeper)`;
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    
    document.getElementById('player2-name-display').textContent = `${gameState.players.nightingale} (Nightingale)`;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;
    
    // 2. Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    
    if (gameState.habits.length === 0) {
        habitsList.innerHTML = `<p class="text-center py-4 text-gray-500 italic">No habits defined. Add a new habit above.</p>`;
    } else {
        gameState.habits.forEach(habit => habitsList.appendChild(createHabitCard(habit)));
    }
    
    // 3. Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    
    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = `<p class="text-center py-4 text-gray-500 italic">No rewards defined yet.</p>`;
    } else {
        gameState.rewards.forEach(reward => rewardsList.appendChild(createRewardCard(reward)));
    }
    
    // 4. Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = `<p class="text-center py-4 text-gray-500 italic">No punishments defined yet.</p>`;
    } else {
        gameState.punishments.forEach(punishment => punishmentsList.appendChild(createPunishmentCard(punishment)));
    }
}

/**
 * Creates the HTML for a single habit card.
 */
function createHabitCard(habit) {
    const element = document.createElement('div');
    element.className = 'card p-4 rounded-xl flex justify-between items-center';
    
    const assigneeName = habit.assignee === 'keeper' ? gameState.players.keeper : gameState.players.nightingale;

    element.innerHTML = `
        <div>
            <p class="text-sm font-semibold text-white">${habit.description}</p>
            <p class="text-xs text-gray-400 mt-1">
                Assigned to: <span class="font-bold text-[#d47e8c]">${assigneeName}</span> 
                | Daily goal: ${habit.timesPerDay} time(s)
            </p>
        </div>
        <div class="flex items-center space-x-3 ml-4 flex-shrink-0">
            <span class="text-lg font-bold text-green-400">+${habit.points}</span>
            <button onclick="window.completeHabit('${habit.id}', '${habit.assignee}', ${habit.points})" 
                    class="btn-primary p-2 text-sm rounded-full w-10 h-10 flex items-center justify-center transition-colors duration-150"
                    title="Complete Habit">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            </button>
            <button onclick="window.confirmDelete('habits', '${habit.id}', '${habit.description}')" 
                    class="p-1 text-gray-500 hover:text-red-500 transition-colors duration-150 rounded-full"
                    title="Delete Habit">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x">
                    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
            </button>
        </div>
    `;
    return element;
}

/**
 * Creates the HTML for a single reward card.
 */
function createRewardCard(reward) {
    const element = document.createElement('div');
    element.className = 'card p-4 rounded-xl';
    
    const isAffordable = gameState.scores.nightingale >= reward.cost;
    const buttonClass = isAffordable ? 'btn-primary' : 'btn-secondary';
    
    element.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <h4 class="text-lg font-bold text-white">${reward.title}</h4>
            <span class="text-xl font-bold text-red-400">- ${reward.cost}</span>
        </div>
        <p class="text-xs text-gray-400 italic mb-3">${reward.description}</p>
        <div class="flex justify-between items-center pt-2 border-t border-[#3c3c45]">
            <p class="text-xs text-gray-500">Redeemer: ${gameState.players.nightingale}</p>
            <button onclick="window.confirmRedeem('${reward.id}', '${reward.title}', ${reward.cost})" 
                    class="${buttonClass} p-2 text-sm rounded-lg font-semibold"
                    ${isAffordable ? '' : 'disabled'}
                    title="${isAffordable ? 'Redeem this reward now' : 'Not enough Nightingale Points'}">
                Redeem
            </button>
            <button onclick="window.confirmDelete('rewards', '${reward.id}', '${reward.title}')" 
                    class="p-1 text-gray-500 hover:text-red-500 transition-colors duration-150 rounded-full"
                    title="Delete Reward Definition">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2">
                    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>
                </svg>
            </button>
        </div>
    `;
    return element;
}

/**
 * Creates the HTML for a single punishment card.
 */
function createPunishmentCard(punishment) {
    const element = document.createElement('div');
    element.className = 'card p-4 rounded-xl';
    
    element.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <h4 class="text-lg font-bold text-white text-[#d47e8c]">${punishment.title}</h4>
            <button onclick="window.confirmDelete('punishments', '${punishment.id}', '${punishment.title}')" 
                    class="p-1 text-gray-500 hover:text-red-500 transition-colors duration-150 rounded-full flex-shrink-0"
                    title="Delete Punishment Definition">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2">
                    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>
                </svg>
            </button>
        </div>
        <p class="text-sm text-gray-300 italic mb-3">${punishment.description}</p>
        <div class="flex justify-between items-center pt-2 border-t border-[#3c3c45]">
            <p class="text-xs text-gray-500">Defined by: Keeper/Nightingale</p>
            <!-- Note: No 'apply' button as punishments are usually applied manually/externally -->
        </div>
    `;
    return element;
}


// --- User Interaction Functions (Exposed to Window) ---

/**
 * Shows the name configuration modal.
 */
window.showNameConfigModal = function() {
    document.getElementById('player1-input').value = gameState.players.keeper;
    document.getElementById('player2-input').value = gameState.players.nightingale;
    document.getElementById('name-config-modal').classList.remove('hidden');
}

/**
 * Saves the player names to the database.
 */
window.savePlayerNames = async function() {
    const p1 = document.getElementById('player1-input').value.trim() || 'User 1';
    const p2 = document.getElementById('player2-input').value.trim() || 'User 2';
    
    if (p1 === p2) {
        showModal("Naming Error", "Usernames must be unique.");
        return;
    }

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    try {
        await updateDoc(docRef, {
            players: {
                keeper: p1,
                nightingale: p2
            }
        });
        document.getElementById('name-config-modal').classList.add('hidden');
        showModal("Success", "Usernames updated!");
    } catch (e) {
        handleError(e, "Failed to save names");
    }
}

/**
 * Toggles visibility of the habit form.
 */
window.toggleHabitForm = function() {
    document.getElementById('habit-form').classList.toggle('hidden');
}

/**
 * Toggles visibility of the reward form.
 */
window.toggleRewardForm = function() {
    document.getElementById('reward-form').classList.toggle('hidden');
}

/**
 * Toggles visibility of the punishment form.
 */
window.togglePunishmentForm = function() {
    document.getElementById('punishment-form').classList.toggle('hidden');
}

/**
 * Completes a habit, adds points, and records the action for undo.
 */
window.completeHabit = async function(habitId, assignee, points) {
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    try {
        const scoreField = `${assignee}Score`;
        const newScore = gameState.scores[assignee] + points;

        // Record the last action for potential undo
        const lastAction = {
            type: 'habit_complete',
            habitId: habitId,
            points: points,
            assignee: assignee,
            previousScore: gameState.scores[assignee]
        };

        const updatePayload = {
            scores: { ...gameState.scores, [assignee]: newScore },
            lastAction: lastAction,
            lastActionTimestamp: Date.now()
        };

        await updateDoc(docRef, updatePayload);
        showToast(`+${points} for ${gameState.players[assignee]}!`, true);
    } catch (e) {
        handleError(e, "Failed to complete habit and update score");
    }
}

/**
 * Confirms redemption of a reward and subtracts points.
 */
window.confirmRedeem = function(rewardId, title, cost) {
    const nightingaleScore = gameState.scores.nightingale;

    if (nightingaleScore < cost) {
        showModal("Insufficient Points", `${gameState.players.nightingale} only has ${nightingaleScore} points. The reward '${title}' costs ${cost}.`);
        return;
    }

    showModal("Redeem Reward", `Are you sure ${gameState.players.nightingale} wants to spend ${cost} points to redeem: '${title}'?`, [
        { text: "Cancel", class: "btn-secondary", action: 'close' },
        { text: "Redeem", class: "btn-primary", action: () => redeemReward(rewardId, cost) }
    ]);
}

/**
 * Executes the reward redemption logic.
 */
async function redeemReward(rewardId, cost) {
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    try {
        const newScore = gameState.scores.nightingale - cost;
        
        // Record the last action for potential undo
        const lastAction = {
            type: 'reward_redeem',
            rewardId: rewardId,
            cost: cost,
            previousScore: gameState.scores.nightingale
        };

        const updatePayload = {
            scores: { ...gameState.scores, nightingale: newScore },
            lastAction: lastAction,
            lastActionTimestamp: Date.now()
        };

        await updateDoc(docRef, updatePayload);
        showToast(`-${cost} points spent! Reward claimed by ${gameState.players.nightingale}.`, true);
    } catch (e) {
        handleError(e, "Failed to redeem reward");
    }
}

/**
 * Adds a new habit definition.
 */
window.addHabit = async function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const times = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;
    
    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0) {
        showModal("Invalid Input", "Please provide a valid description, positive points, and positive times per day.");
        return;
    }

    const newHabit = {
        id: generateId(),
        description: desc,
        points: points,
        timesPerDay: times,
        assignee: assignee,
    };

    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, {
            habits: [...gameState.habits, newHabit]
        });
        document.getElementById('new-habit-desc').value = '';
        document.getElementById('new-habit-points').value = '10';
        document.getElementById('new-habit-times').value = '1';
        toggleHabitForm();
        showModal("Success", "New habit added!");
    } catch (e) {
        handleError(e, "Failed to add habit");
    }
}

/**
 * Adds a new reward definition.
 */
window.addReward = async function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const desc = document.getElementById('new-reward-desc').value.trim();
    
    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a title, description, and a positive point cost.");
        return;
    }

    const newReward = {
        id: generateId(),
        title: title,
        cost: cost,
        description: desc,
    };

    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, {
            rewards: [...gameState.rewards, newReward]
        });
        document.getElementById('new-reward-title').value = '';
        document.getElementById('new-reward-cost').value = '50';
        document.getElementById('new-reward-desc').value = '';
        toggleRewardForm();
        showModal("Success", "New reward defined!");
    } catch (e) {
        handleError(e, "Failed to add reward");
    }
}

/**
 * Adds a new punishment definition.
 */
window.addPunishment = async function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();
    
    if (!title || !desc) {
        showModal("Invalid Input", "Please provide both a title and a description for the punishment.");
        return;
    }

    const newPunishment = {
        id: generateId(),
        title: title,
        description: desc,
    };

    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, {
            punishments: [...gameState.punishments, newPunishment]
        });
        document.getElementById('new-punishment-title').value = '';
        document.getElementById('new-punishment-desc').value = '';
        togglePunishmentForm();
        showModal("Success", "New punishment added!");
    } catch (e) {
        handleError(e, "Failed to add punishment");
    }
}


/**
 * Confirms deletion of a habit, reward, or punishment definition.
 */
window.confirmDelete = function(collectionName, itemId, title) {
    showModal("Confirm Deletion", `Are you sure you want to permanently delete the definition: '${title}'?`, [
        { text: "Cancel", class: "btn-secondary", action: 'close' },
        { text: "Delete", class: "btn-primary bg-red-600 hover:bg-red-700", action: () => deleteItem(collectionName, itemId, title) }
    ]);
}

/**
 * Deletes a habit, reward, or punishment definition and records it for undo.
 */
async function deleteItem(collectionName, itemId, title) {
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    const currentItems = [...gameState[collectionName]];
    const itemToDelete = currentItems.find(item => item.id === itemId);
    const updatedItems = currentItems.filter(item => item.id !== itemId);
    
    if (!itemToDelete) {
        showModal("Error", "Item not found for deletion.");
        return;
    }

    try {
        // Record deleted item for undo functionality
        const lastAction = {
            type: 'item_delete',
            collection: collectionName,
            item: itemToDelete,
            previousItems: currentItems // Snapshot before deletion
        };

        const updatePayload = {};
        updatePayload[collectionName] = updatedItems;
        updatePayload['lastAction'] = lastAction;
        updatePayload['lastActionTimestamp'] = Date.now();

        await updateDoc(docRef, updatePayload);
        showToast(`${title} definition deleted.`, true);
    } catch (e) {
        handleError(e, `Failed to remove item from ${collectionName}`);
    }
}

/**
 * Undoes the last action (score change or item deletion).
 */
window.undoAction = async function() {
    hideToast();
    const action = gameState.lastAction;
    
    if (!action) {
        showModal("No Action", "No recent action found to undo.");
        return;
    }
    
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    const updatePayload = {};
    
    let undoMessage = "Action successfully undone.";

    try {
        switch (action.type) {
            case 'habit_complete':
                // Revert score change
                const newScore = action.previousScore;
                updatePayload.scores = { ...gameState.scores, [action.assignee]: newScore };
                undoMessage = `Reverted ${action.points} points for ${gameState.players[action.assignee]}.`;
                break;
            
            case 'reward_redeem':
                // Revert score change
                const revertedScore = action.previousScore;
                updatePayload.scores = { ...gameState.scores, nightingale: revertedScore };
                undoMessage = `Reverted ${action.cost} points for ${gameState.players.nightingale}.`;
                break;

            case 'item_delete':
                // Restore the item list
                updatePayload[action.collection] = action.previousItems;
                undoMessage = `Restored '${action.item.title || action.item.description}' to ${action.collection}.`;
                break;
                
            default:
                showModal("Undo Error", "Unknown action type. Cannot undo.");
                return;
        }

        // Clear the last action record after undoing
        updatePayload.lastAction = null;
        updatePayload.lastActionTimestamp = 0;
        
        await updateDoc(docRef, updatePayload);
        showModal("Undo Successful", undoMessage);

    } catch (e) {
        handleError(e, "Failed to perform undo operation");
    }
}

/**
 * Generates an example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        showModal("Error", "Example data is not loaded correctly.");
        return;
    }
    
    const examples = EXAMPLE_DATABASE[type + 's'];
    const randomIndex = Math.floor(Math.random() * examples.length);
    const example = examples[randomIndex];

    if (type === 'habit') {
        document.getElementById('new-habit-desc').value = example.description;
        document.getElementById('new-habit-points').value = example.points;
        document.getElementById('new-habit-times').value = 1; // Default to 1
        document.getElementById('new-habit-assignee').value = example.type;
        window.toggleHabitForm(); // Ensure visible
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        window.toggleRewardForm(); // Ensure visible
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        window.togglePunishmentForm(); // Ensure visible
    }
}


// Initialize on load
initializeFirebase();
