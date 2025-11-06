import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---
// Note: EXAMPLE_DATABASE is expected to be loaded via examples.js first.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
// The config provided by the environment, parsed from JSON string
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
// Path for public/shared data (e.g., the ledger)
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
    history: []
};

// --- Utility Functions ---

/**
 * Custom alert/modal implementation since window.alert() is forbidden.
 */
window.showModal = function(title, message) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    modal.classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('custom-modal').classList.add('hidden');
}

/**
 * Initializes Firebase, authenticates the user, and sets up the listener.
 * This is where the configuration error check is implemented.
 */
async function initFirebase() {
    console.log("Attempting Firebase initialization...");
    document.getElementById('current-app-id').textContent = appId;
    
    if (!firebaseConfig) {
        // Fix for "Firebase config is missing" error.
        console.error("Firebase config is missing or invalid. Cannot initialize Firebase.");
        showModal("Configuration Error", "The Firebase configuration data is missing. Cannot initialize Firebase services.");
        document.getElementById('current-user-id').textContent = 'CONFIG MISSING';
        return;
    }
    
    try {
        // Initialize Firebase app (this was the point of failure)
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Authenticate user using custom token or anonymously
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        // Set up Auth State Listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                // Public collection path for shared state
                GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state`;
                
                document.getElementById('current-user-id').textContent = userId;
                console.log(`User authenticated. UID: ${userId}, State Path: ${GAME_STATE_PATH}`);
                
                // Start listening for game state updates
                setupGameStateListener();
            } else {
                userId = null;
                document.getElementById('current-user-id').textContent = 'NOT AUTHENTICATED';
                console.warn("User signed out or authentication failed.");
            }
        });

    } catch (error) {
        console.error("Firebase initialization failed:", error);
        showModal("Initialization Failed", `Could not connect to Firebase: ${error.message}`);
    }
}

/**
 * Sets up the real-time listener for the shared game state.
 */
function setupGameStateListener() {
    if (!db || !GAME_STATE_PATH) return;

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    // onSnapshot listener for real-time updates
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log("Real-time update received.");
            
            gameState = { 
                ...gameState, 
                ...data,
                // Ensure array fields default correctly
                habits: data.habits || [],
                rewards: data.rewards || [],
                punishments: data.punishments || [],
                history: data.history || []
            };
            renderState();
        } else {
            console.log("No game state found. Creating initial document.");
            initializeGameState();
        }
    }, (error) => {
        console.error("Error listening to game state:", error);
        showModal("Database Error", "Failed to load real-time game state.");
    });
}


/**
 * Initializes the document if it doesn't exist.
 */
async function initializeGameState() {
    if (!db || !GAME_STATE_PATH) return;
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    try {
        await setDoc(docRef, gameState);
        console.log("Initial game state written successfully.");
    } catch (e) {
        console.error("Error initializing game state:", e);
    }
}

/**
 * Updates the game state in Firestore.
 */
async function updateGameState(updates) {
    if (!db || !GAME_STATE_PATH || !userId) {
        showModal("Error", "System not ready. Please wait for authentication.");
        return;
    }

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    try {
        // Merge new updates with current state
        const newState = { ...gameState, ...updates };
        await updateDoc(docRef, newState);
        console.log("Game state updated.");
    } catch (e) {
        console.error("Error updating document:", e);
        showModal("Update Failed", `Could not save changes: ${e.message}`);
    }
}

// --- Main Render Logic ---

/**
 * Renders the entire application state based on the local 'gameState'.
 */
function renderState() {
    // 1. Render Scores
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;
    document.getElementById('player-name-keeper').textContent = gameState.players.keeper;
    document.getElementById('player-name-nightingale').textContent = gameState.players.nightingale;

    // 2. Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    if (gameState.habits.length === 0) {
        document.getElementById('habits-loading').classList.remove('hidden');
    } else {
        document.getElementById('habits-loading').classList.add('hidden');
        gameState.habits.forEach((habit, index) => {
            habitsList.innerHTML += renderHabitCard(habit, index);
        });
    }

    // 3. Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    if (gameState.rewards.length === 0) {
        document.getElementById('rewards-loading').classList.remove('hidden');
    } else {
        document.getElementById('rewards-loading').classList.add('hidden');
        gameState.rewards.forEach((reward, index) => {
            rewardsList.innerHTML += renderRewardCard(reward, index);
        });
    }

    // 4. Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    if (gameState.punishments.length === 0) {
        document.getElementById('punishments-loading').classList.remove('hidden');
    } else {
        document.getElementById('punishments-loading').classList.add('hidden');
        gameState.punishments.forEach((punishment, index) => {
            punishmentsList.innerHTML += renderPunishmentCard(punishment, index);
        });
    }

    // 5. Render History (Simplified for this version)
    const historyList = document.getElementById('history-log');
    historyList.innerHTML = gameState.history.slice(-5).reverse().map(item => 
        `<li class="text-sm border-b border-[#3c3c45] py-1">${item.timestamp}: ${item.message}</li>`
    ).join('');
    if (gameState.history.length === 0) {
        historyList.innerHTML = '<li class="text-sm text-gray-500 italic">No activity yet.</li>';
    }
}

// --- Card Render Templates ---

function renderHabitCard(habit, index) {
    const assignee = habit.type === 'keeper' ? gameState.players.keeper : gameState.players.nightingale;
    const color = habit.type === 'keeper' ? 'text-[#00bfff]' : 'text-[#b05c6c]'; // Keeper (Blue), Nightingale (Red)

    return `
        <div class="habit-card bg-[#1a1a1d] p-4 rounded-xl shadow-lg border border-[#3c3c45] transition duration-300 hover:border-[#b05c6c]">
            <p class="text-xs ${color} font-semibold mb-1 uppercase tracking-wider">${assignee}'s Habit</p>
            <p class="text-white text-md mb-2">${habit.description}</p>
            <div class="flex justify-between items-center text-sm">
                <span class="text-gray-400">Repeats: ${habit.times} time(s)</span>
                <span class="text-green-400 font-bold">+${habit.points} Points</span>
                <button onclick="window.markHabitComplete(${index})" class="btn-sm rounded-full bg-green-700 hover:bg-green-600 px-3 py-1 text-white text-xs font-semibold">Done</button>
                <button onclick="window.removeHabit(${index})" class="text-gray-600 hover:text-red-500 transition duration-150 ml-2" title="Remove Habit">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    `;
}

function renderRewardCard(reward, index) {
    const canAffordKeeper = gameState.scores.keeper >= reward.cost;
    const canAffordNightingale = gameState.scores.nightingale >= reward.cost;

    return `
        <div class="reward-card bg-[#1a1a1d] p-4 rounded-xl shadow-lg border border-[#3c3c45] transition duration-300 hover:border-[#00bfff]">
            <h4 class="text-lg text-[#00bfff] font-cinzel mb-1">${reward.title}</h4>
            <p class="text-sm text-gray-300 mb-3">${reward.description}</p>
            <div class="flex justify-between items-center text-sm">
                <span class="text-yellow-500 font-bold">${reward.cost} Points</span>
                
                <div class="flex space-x-2">
                    <button ${canAffordKeeper ? '' : 'disabled'} 
                        onclick="window.claimReward(${index}, 'keeper')" 
                        class="btn-sm px-3 py-1 rounded-full text-xs font-semibold 
                        ${canAffordKeeper ? 'bg-[#00bfff] hover:bg-sky-400 text-black' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}"
                        title="${canAffordKeeper ? 'Claim for Keeper' : 'Keeper cannot afford'}">
                        ${gameState.players.keeper}
                    </button>
                    
                    <button ${canAffordNightingale ? '' : 'disabled'} 
                        onclick="window.claimReward(${index}, 'nightingale')" 
                        class="btn-sm px-3 py-1 rounded-full text-xs font-semibold 
                        ${canAffordNightingale ? 'bg-[#b05c6c] hover:bg-red-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}"
                        title="${canAffordNightingale ? 'Claim for Nightingale' : 'Nightingale cannot afford'}">
                        ${gameState.players.nightingale}
                    </button>
                </div>
                <button onclick="window.removeReward(${index})" class="text-gray-600 hover:text-red-500 transition duration-150" title="Remove Reward">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    `;
}

function renderPunishmentCard(punishment, index) {
    return `
        <div class="punishment-card bg-[#1a1a1d] p-4 rounded-xl shadow-lg border border-[#3c3c45] transition duration-300 hover:border-[#d97706]">
            <h4 class="text-lg text-[#d97706] font-cinzel mb-1">${punishment.title}</h4>
            <p class="text-sm text-gray-300 mb-3">${punishment.description}</p>
            <div class="flex justify-end items-center text-sm space-x-2">
                <button onclick="window.removePunishment(${index})" class="text-gray-600 hover:text-red-500 transition duration-150" title="Remove Punishment">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    `;
}

// --- Action Handlers (Form Toggles) ---

/**
 * Handles toggling the visibility of the input forms.
 */
window.toggleHabitForm = function() {
    document.getElementById('add-habit-form').classList.toggle('hidden');
}

window.toggleRewardForm = function() {
    document.getElementById('add-reward-form').classList.toggle('hidden');
}

window.togglePunishmentForm = function() {
    document.getElementById('add-punishment-form').classList.toggle('hidden');
}

// --- Action Handlers (Add/Modify) ---

/**
 * Adds a new habit to the game state.
 */
window.addHabit = function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const times = parseInt(document.getElementById('new-habit-times').value, 10);
    const type = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0 || (type !== 'keeper' && type !== 'nightingale')) {
        showModal("Invalid Habit", "Please enter a valid description, positive points, and positive times for the habit.");
        return;
    }

    const newHabit = { 
        id: crypto.randomUUID(), 
        description: desc, 
        points: points, 
        times: times, 
        type: type 
    };

    const newHabits = [...gameState.habits, newHabit];
    const message = `Defined a new habit for ${gameState.players[type]} worth +${points} points: "${desc}".`;

    updateGameState({
        habits: newHabits,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });

    // Clear and hide form
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    document.getElementById('new-habit-times').value = 1;
    window.toggleHabitForm();
}

/**
 * Marks a habit as complete, updating the score and history, then removes the habit.
 */
window.markHabitComplete = function(index) {
    const habit = gameState.habits[index];
    if (!habit) return;

    const newScore = gameState.scores[habit.type] + (habit.points * habit.times);
    const newHabits = gameState.habits.filter((_, i) => i !== index);
    const message = `${gameState.players[habit.type]} completed a habit for +${habit.points * habit.times} points: "${habit.description}".`;
    
    updateGameState({
        scores: { ...gameState.scores, [habit.type]: newScore },
        habits: newHabits,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });
}

/**
 * Adds a new reward to the game state.
 */
window.addReward = function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Invalid Reward", "Please enter a valid title, description, and positive cost for the reward.");
        return;
    }

    const newReward = { title, cost, description: desc };
    const newRewards = [...gameState.rewards, newReward];
    const message = `Defined a new reward, "${title}", costing ${cost} points.`;

    updateGameState({
        rewards: newRewards,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });

    // Clear and hide form
    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = 100;
    document.getElementById('new-reward-desc').value = '';
    window.toggleRewardForm();
}

/**
 * Claims a reward, subtracting the cost from the player's score and removing the reward.
 */
window.claimReward = function(index, playerType) {
    const reward = gameState.rewards[index];
    if (!reward) return;

    if (gameState.scores[playerType] < reward.cost) {
        showModal("Insufficient Points", `${gameState.players[playerType]} does not have enough points to claim this reward.`);
        return;
    }

    const newScore = gameState.scores[playerType] - reward.cost;
    const newRewards = gameState.rewards.filter((_, i) => i !== index);
    const message = `${gameState.players[playerType]} claimed reward "${reward.title}" for -${reward.cost} points.`;
    
    updateGameState({
        scores: { ...gameState.scores, [playerType]: newScore },
        rewards: newRewards,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });
}


/**
 * Adds a new punishment to the game state.
 */
window.addPunishment = function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Invalid Punishment", "Please enter a valid title and description for the punishment.");
        return;
    }

    const newPunishment = { title, description: desc };
    const newPunishments = [...gameState.punishments, newPunishment];
    const message = `Defined a new punishment: "${title}".`;

    updateGameState({
        punishments: newPunishments,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });

    // Clear and hide form
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.togglePunishmentForm();
}

// --- Removal Functions (No confirm() used) ---

window.removeHabit = function(index) {
    const habit = gameState.habits[index];
    if (!habit) return;

    const newHabits = gameState.habits.filter((_, i) => i !== index);
    const message = `Removed the habit: "${habit.description}".`;
    updateGameState({
        habits: newHabits,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });
    showModal("Item Removed", `Habit "${habit.description}" has been removed.`);
}

window.removeReward = function(index) {
    const reward = gameState.rewards[index];
    if (!reward) return;
    
    const newRewards = gameState.rewards.filter((_, i) => i !== index);
    const message = `Removed the reward: "${reward.title}".`;
    updateGameState({
        rewards: newRewards,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });
    showModal("Item Removed", `Reward "${reward.title}" has been removed.`);
}

window.removePunishment = function(index) {
    const punishment = gameState.punishments[index];
    if (!punishment) return;
    
    const newPunishments = gameState.punishments.filter((_, i) => i !== index);
    const message = `Removed the punishment: "${punishment.title}".`;
    updateGameState({
        punishments: newPunishments,
        history: [...gameState.history, { timestamp: new Date().toLocaleTimeString(), message }]
    });
    showModal("Item Removed", `Punishment "${punishment.title}" has been removed.`);
}

// --- Helper for generating example data (uses the globally loaded EXAMPLE_DATABASE) ---

/**
 * Loads a random example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    // Access the global EXAMPLE_DATABASE provided by the examples.js file
    const exampleDatabase = typeof EXAMPLE_DATABASE !== 'undefined' ? EXAMPLE_DATABASE : null;

    if (!exampleDatabase || !exampleDatabase[type + 's']) {
        showModal("Error", "Example data is not loaded correctly. Please ensure examples.js is loaded.");
        return;
    }
    
    const examples = exampleDatabase[type + 's'];
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

window.onload = () => {
    // Attach event listeners for modal closure
    document.getElementById('modal-close-btn').onclick = window.closeModal;
    document.getElementById('custom-modal-backdrop').onclick = window.closeModal;

    // Call the function that was reported as failing.
    initFirebase();
};

// Since native window.alert is forbidden, we map it to our custom modal
window.alert = function(message) {
    showModal("Notice", message);
}