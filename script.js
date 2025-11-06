import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc, setLogLevel, arrayUnion, arrayRemove, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---\
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
    currentCycle: {
        id: Date.now(), // Unique ID for the current cycle
        dateStarted: new Date().toISOString(),
        habitCompletions: {} // { habitId: { keeper: 0, nightingale: 0 } }
    },
};
let currentPlayer = 'keeper'; // 'keeper' or 'nightingale'

// --- Utility Functions ---

/**
 * Toggles visibility between the authentication screen and the main app content.
 * @param {('auth-screen'|'app-content')} viewId The ID of the view to show.
 */
function showView(viewId) {
    const views = ['auth-screen', 'app-content'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === viewId) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });
}

/**
 * Displays a custom modal message.
 * @param {string} title The title of the modal.
 * @param {string} message The message content.
 */
function showModal(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-container').classList.remove('hidden');
}

/**
 * Closes the custom modal message.
 */
window.closeModal = function() {
    document.getElementById('modal-container').classList.add('hidden');
};

/**
 * Initializes Firebase, authenticates the user, and sets up the primary listener.
 * This is the core logic for ensuring authentication success before showing the app.
 */
async function initFirebase() {
    if (!firebaseConfig) {
        console.error("Firebase config is missing.");
        showModal("Configuration Error", "Firebase configuration could not be loaded. Please check your setup.");
        showView('auth-screen'); // Stay on auth screen
        return;
    }

    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    
    // Set Firestore log level for debugging
    setLogLevel('debug');
    
    // Set the initial view to the loading screen
    showView('auth-screen');

    // 1. Set up the state change listener FIRST. This listener determines what view to show.
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // SUCCESS: User ID acquired. Set global state and show main app content.
            userId = user.uid;
            // Public data path for shared ledger
            GAME_STATE_PATH = `/artifacts/${appId}/public/data/ledger_data`;
            
            document.getElementById('current-user-id').textContent = userId;
            document.getElementById('current-app-id').textContent = appId;
            
            // Check if the game document exists and create it if not
            await initializeGameDocument();
            
            // Show the main application content
            showView('app-content');
            
            // Start listening for real-time updates
            setupGameListeners();
            
        } else {
            // FAILURE: User is null (authentication failed or token expired). Show auth screen.
            userId = null;
            document.getElementById('current-user-id').textContent = 'Not Authenticated';
            showView('auth-screen');
        }
    });

    // 2. Attempt to sign in using the provided token or anonymously.
    try {
        if (initialAuthToken) {
            console.log("Attempting sign-in with custom token.");
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            console.log("Attempting anonymous sign-in (no custom token provided).");
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Authentication failed during initial sign-in attempt:", error);
        // The onAuthStateChanged listener will handle showing the auth-screen if this fails.
    }
}


/**
 * Initializes the game document in Firestore if it doesn't exist.
 */
async function initializeGameDocument() {
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    try {
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            console.log("Game document does not exist. Creating default document.");
            // Set the initial default state
            await setDoc(docRef, gameState);
        }
    } catch (error) {
        console.error("Error checking/creating game document:", error);
        showModal("Database Error", "Failed to access the shared ledger document. Please check console for details.");
    }
}


/**
 * Sets up the real-time listener for the main game state document.
 */
function setupGameListeners() {
    if (!userId) {
        console.warn("Cannot set up listeners: userId is null.");
        return;
    }
    
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    onSnapshot(docRef, (doc) => {
        if (doc.exists()) {
            // Update the global state and re-render all components
            gameState = doc.data();
            console.log("Game state updated:", gameState);
            
            // Re-render UI components
            renderScores();
            renderHabits();
            renderRewards();
            renderPunishments();
            renderTracker();
            
        } else {
            console.error("Game state document vanished!");
            // If the document is deleted, we should try to recreate it
            initializeGameDocument();
        }
    }, (error) => {
        console.error("Firestore snapshot error:", error);
        showModal("Connection Error", "Lost connection to the ledger. Check your network or console for details.");
    });
}


// --- UI Rendering Functions ---

/**
 * Renders the main scoreboard.
 */
function renderScores() {
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;
}

/**
 * Renders the list of defined habits.
 */
function renderHabits() {
    const list = document.getElementById('habits-list');
    list.innerHTML = '';
    
    if (gameState.habits.length === 0) {
        list.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined yet.</p>';
        document.getElementById('tracker-loading').textContent = 'No habits defined to track.';
        return;
    }

    document.getElementById('tracker-loading').classList.add('hidden');

    gameState.habits.forEach(habit => {
        const el = document.createElement('div');
        el.className = 'card p-4 flex justify-between items-center bg-[#1a1a1d]';
        el.innerHTML = `
            <div>
                <p class="text-lg font-bold text-white">${habit.description}</p>
                <p class="text-sm text-gray-400">
                    <span class="text-[#b05c6c] font-semibold">${habit.points} Pts</span> | 
                    ${habit.timesPerCycle} time(s) per cycle | 
                    Assigned to: <span class="capitalize">${habit.assignee}</span>
                </p>
            </div>
            <button onclick="window.removeHabit('${habit.id}')" class="text-red-500 hover:text-red-400 p-2 rounded-full transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        `;
        list.appendChild(el);
    });
}

/**
 * Renders the list of defined rewards.
 */
function renderRewards() {
    const list = document.getElementById('rewards-list');
    list.innerHTML = '';
    
    if (gameState.rewards.length === 0) {
        list.innerHTML = '<p class="text-center py-4 text-gray-500 italic" id="rewards-loading">No rewards defined yet.</p>';
        return;
    }

    gameState.rewards.forEach(reward => {
        const el = document.createElement('div');
        el.className = 'card p-4 bg-[#1a1a1d]';
        el.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <p class="text-xl font-bold text-white">${reward.title}</p>
                <p class="text-2xl font-cinzel text-[#b05c6c] font-bold">${reward.cost}</p>
            </div>
            <p class="text-sm text-gray-400 mb-3">${reward.description}</p>
            <div class="flex space-x-2">
                <button onclick="window.redeemReward('${reward.id}')" class="btn-primary flex-1 rounded-lg text-sm px-3 py-1 font-sans font-semibold">Redeem</button>
                <button onclick="window.removeReward('${reward.id}')" class="text-red-500 hover:text-red-400 p-2 rounded-full transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        `;
        list.appendChild(el);
    });
}

/**
 * Renders the list of defined punishments.
 */
function renderPunishments() {
    const list = document.getElementById('punishments-list');
    list.innerHTML = '';
    
    if (gameState.punishments.length === 0) {
        list.innerHTML = '<p class="text-center py-4 text-gray-500 italic" id="punishments-loading">No punishments defined yet.</p>';
        return;
    }

    gameState.punishments.forEach(punishment => {
        const el = document.createElement('div');
        el.className = 'card p-4 bg-[#1a1a1d] flex justify-between items-center';
        el.innerHTML = `
            <div>
                <p class="text-xl font-bold text-white">${punishment.title}</p>
                <p class="text-sm text-gray-400">${punishment.description}</p>
            </div>
            <button onclick="window.removePunishment('${punishment.id}')" class="text-red-500 hover:text-red-400 p-2 rounded-full transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        `;
        list.appendChild(el);
    });
}

/**
 * Renders the habit tracker for the current player.
 */
function renderTracker() {
    const container = document.getElementById('tracker-container');
    container.innerHTML = '';

    if (gameState.habits.length === 0) {
        container.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined to track.</p>';
        return;
    }
    
    // Ensure the current cycle data is initialized for the tracker
    if (!gameState.currentCycle || !gameState.currentCycle.habitCompletions) {
        gameState.currentCycle = { id: Date.now(), dateStarted: new Date().toISOString(), habitCompletions: {} };
    }

    const assignedHabits = gameState.habits.filter(h => h.assignee === currentPlayer);

    if (assignedHabits.length === 0) {
        container.innerHTML = `<p class="text-center py-4 text-gray-500 italic">The ${currentPlayer} has no assigned habits.</p>`;
        return;
    }

    assignedHabits.forEach(habit => {
        // Initialize completion count for this habit if it doesn't exist
        if (!gameState.currentCycle.habitCompletions[habit.id]) {
            gameState.currentCycle.habitCompletions[habit.id] = { keeper: 0, nightingale: 0 };
        }

        const completions = gameState.currentCycle.habitCompletions[habit.id][currentPlayer];
        const required = habit.timesPerCycle;
        const isComplete = completions >= required;
        const buttonClass = isComplete ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary';

        const el = document.createElement('div');
        el.className = 'card p-4 flex justify-between items-center bg-[#1a1a1d]';
        el.innerHTML = `
            <div class="flex-1 mr-4">
                <p class="text-lg font-semibold text-white">${habit.description}</p>
                <p class="text-sm text-gray-400">
                    Progress: <span class="font-bold text-[#b05c6c]">${completions} / ${required}</span> completion(s)
                    <span class="${isComplete ? 'text-green-500' : 'text-yellow-500'} font-bold ml-2">${isComplete ? 'COMPLETE' : 'IN PROGRESS'}</span>
                </p>
            </div>
            <button onclick="window.logCompletion('${habit.id}')" 
                    class="${buttonClass} rounded-lg text-sm px-4 py-2 font-sans font-semibold transition-all duration-200"
                    ${isComplete ? 'disabled' : ''}>
                Log Completion (+${habit.points} Pts)
            </button>
        `;
        container.appendChild(el);
    });
}


// --- Firestore Update Functions ---

/**
 * Updates the game state in Firestore. Uses exponential backoff for retries.
 * @param {object} updates The fields to update in the game document.
 */
async function updateGameState(updates, retries = 0) {
    if (!userId) {
        showModal("Authentication Required", "You must be authenticated to update the ledger.");
        return;
    }

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    const MAX_RETRIES = 5;

    try {
        await updateDoc(docRef, updates);
    } catch (error) {
        console.error("Firestore update failed:", error);
        if (retries < MAX_RETRIES) {
            const delay = Math.pow(2, retries) * 1000; // 1s, 2s, 4s, 8s, 16s
            console.log(`Retrying update in ${delay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            await updateGameState(updates, retries + 1);
        } else {
            showModal("Update Failed", "Could not save changes to the ledger after several attempts. Please try again.");
        }
    }
}

/**
 * Adds a new habit to the game state.
 */
window.addHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const timesPerCycle = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || isNaN(timesPerCycle) || timesPerCycle <= 0) {
        showModal("Invalid Input", "Please provide a valid description, positive points, and positive times per cycle.");
        return;
    }

    const newHabit = {
        id: crypto.randomUUID(),
        description: desc,
        points: points,
        timesPerCycle: timesPerCycle,
        assignee: assignee, // 'keeper' or 'nightingale'
    };

    updateGameState({
        habits: arrayUnion(newHabit)
    });

    // Clear form and hide
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    document.getElementById('new-habit-times').value = 1;
    document.getElementById('habit-form').classList.add('hidden');
}

/**
 * Removes a habit from the game state.
 * @param {string} habitId The ID of the habit to remove.
 */
window.removeHabit = function(habitId) {
    const habitToRemove = gameState.habits.find(h => h.id === habitId);
    if (!habitToRemove) return;

    updateGameState({
        habits: arrayRemove(habitToRemove)
    });
}

/**
 * Adds a new reward to the game state.
 */
window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a title, description, and a positive point cost for the reward.");
        return;
    }

    const newReward = {
        id: crypto.randomUUID(),
        title: title,
        cost: cost,
        description: desc,
    };

    updateGameState({
        rewards: arrayUnion(newReward)
    });

    // Clear form and hide
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = 100;
    document.getElementById('new-reward-desc').value = '';
    document.getElementById('reward-form').classList.add('hidden');
}

/**
 * Removes a reward from the game state.
 * @param {string} rewardId The ID of the reward to remove.
 */
window.removeReward = function(rewardId) {
    const rewardToRemove = gameState.rewards.find(r => r.id === rewardId);
    if (!rewardToRemove) return;

    updateGameState({
        rewards: arrayRemove(rewardToRemove)
    });
}

/**
 * Adds a new punishment to the game state.
 */
window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Input", "Please provide a title and description for the punishment.");
        return;
    }

    const newPunishment = {
        id: crypto.randomUUID(),
        title: title,
        description: desc,
    };

    updateGameState({
        punishments: arrayUnion(newPunishment)
    });

    // Clear form and hide
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    document.getElementById('punishment-form').classList.add('hidden');
}

/**
 * Removes a punishment from the game state.
 * @param {string} punishmentId The ID of the punishment to remove.
 */
window.removePunishment = function(punishmentId) {
    const punishmentToRemove = gameState.punishments.find(p => p.id === punishmentId);
    if (!punishmentToRemove) return;

    updateGameState({
        punishments: arrayRemove(punishmentToRemove)
    });
}


/**
 * Handles the logic for logging a habit completion.
 * @param {string} habitId The ID of the habit completed.
 */
window.logCompletion = function(habitId) {
    const habit = gameState.habits.find(h => h.id === habitId);
    if (!habit || habit.assignee !== currentPlayer) {
        showModal("Error", "Habit not found or not assigned to the current player.");
        return;
    }

    const currentCompletions = gameState.currentCycle.habitCompletions[habitId]?.[currentPlayer] || 0;
    const required = habit.timesPerCycle;

    if (currentCompletions >= required) {
        showModal("Already Complete", `This habit is already fully completed (${required}/${required}) for this cycle.`);
        return;
    }

    // 1. Update completion count
    const newCompletions = currentCompletions + 1;
    const completionPath = `currentCycle.habitCompletions.${habitId}.${currentPlayer}`;
    
    // 2. Update score only if it's the *last* required completion
    const scoreUpdate = newCompletions === required ? habit.points : 0;
    
    const updates = {
        [completionPath]: newCompletions,
        [`scores.${currentPlayer}`]: gameState.scores[currentPlayer] + scoreUpdate
    };
    
    updateGameState(updates);
}

/**
 * Handles the logic for redeeming a reward.
 * @param {string} rewardId The ID of the reward to redeem.
 */
window.redeemReward = function(rewardId) {
    const reward = gameState.rewards.find(r => r.id === rewardId);
    if (!reward) return;

    // Use the *other* player's score to redeem (assuming the other player is 'buying' the reward)
    const buyer = currentPlayer === 'keeper' ? 'nightingale' : 'keeper';
    const currentScore = gameState.scores[buyer];

    if (currentScore < reward.cost) {
        showModal("Insufficient Points", `The ${buyer} does not have enough points (needs ${reward.cost}, has ${currentScore}) to redeem "${reward.title}".`);
        return;
    }

    const newScore = currentScore - reward.cost;

    updateGameState({
        [`scores.${buyer}`]: newScore
    }).then(() => {
        // Remove the reward after successful redemption
        window.removeReward(rewardId); 
        showModal("Reward Redeemed!", `"${reward.title}" has been redeemed! ${reward.cost} points deducted from the ${buyer}'s score.`);
    });
}


// --- Form/UI Toggles ---

window.toggleHabitForm = function() {
    const form = document.getElementById('habit-form');
    form.classList.toggle('hidden');
}

window.toggleRewardForm = function() {
    const form = document.getElementById('reward-form');
    form.classList.toggle('hidden');
}

window.togglePunishmentForm = function() {
    const form = document.getElementById('punishment-form');
    form.classList.toggle('hidden');
}

/**
 * Sets the player context for the UI (tracker/actions).
 * @param {string} player 'keeper' or 'nightingale'
 */
window.setCurrentPlayer = function(player) {
    if (player === 'keeper' || player === 'nightingale') {
        currentPlayer = player;
        renderTracker(); // Re-render the tracker for the current player
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


// --- Initialization ---

// Start the Firebase setup when the script loads
initFirebase();