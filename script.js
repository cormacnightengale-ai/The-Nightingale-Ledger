import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    onSnapshot, 
    setDoc, 
    getDoc,
    serverTimestamp,
    setLogLevel 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firebase log level for debugging
setLogLevel('debug');


// --- Global Variables (Provided by Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-shared-ledger';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let isInitialized = false; 

// Path for public/shared data: artifacts/{appId}/public/data/ledger_state/{docId}
const GAME_STATE_DOC_ID = 'ledger_data';
const GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state/${GAME_STATE_DOC_ID}`;

// Default Game State structure (Now using P1 and P2 for reciprocity)
let gameState = {
    players: {
        p1: 'Player 1',
        p2: 'Player 2'
    },
    scores: {
        p1: 0,
        p2: 0
    },
    habits: [],
    rewards: [],
    punishments: [],
    history: []
};

// --- Utility Functions ---

/**
 * Custom modal implementation for alerts and notices.
 */
function showModal(title, message, isConfirm = false) {
    // ... (Modal implementation remains the same)
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    
    const okBtn = document.getElementById('modal-ok-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    cancelBtn.classList.add('hidden');

    if (isConfirm) {
        cancelBtn.classList.remove('hidden');
        return new Promise((resolve) => {
            okBtn.onclick = () => {
                modal.classList.add('hidden');
                resolve(true);
            };
            cancelBtn.onclick = () => {
                modal.classList.add('hidden');
                resolve(false);
            };
        });
    } else {
        okBtn.onclick = () => {
            modal.classList.add('hidden');
        };
    }
    
    modal.classList.remove('hidden');
}

/**
 * Persists the current game state to Firestore.
 */
async function saveState(retryCount = 0) {
    if (!db || !userId) {
        console.error("Firestore not initialized or userId not set.");
        return;
    }

    try {
        const stateToSave = {
            ...gameState,
            updatedAt: serverTimestamp(),
        };
        // Use merge: true to avoid overwriting the entire document if other fields exist
        await setDoc(doc(db, GAME_STATE_PATH), stateToSave, { merge: true });
        console.log("Game state saved successfully.");
    } catch (error) {
        console.error("Error saving game state:", error);
        
        if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000; 
            setTimeout(() => saveState(retryCount + 1), delay);
        } else {
            showModal("Error Saving Data", "Could not save the ledger data after multiple attempts.");
        }
    }
}

/**
 * Returns the player name and CSS class based on player ID ('p1' or 'p2').
 */
function getPlayerInfo(playerId) {
    const name = gameState.players[playerId] || `Unknown ${playerId.toUpperCase()}`;
    const colorClass = `text-${playerId}`;
    const backgroundClass = `bg-${playerId}-light`;
    return { name, colorClass, backgroundClass };
}

/**
 * Renders the main application state to the DOM.
 */
function renderState() {
    // 1. Player Names and IDs
    const p1Info = getPlayerInfo('p1');
    const p2Info = getPlayerInfo('p2');

    document.getElementById('p1-name').value = p1Info.name;
    document.getElementById('p2-name').value = p2Info.name;
    
    document.getElementById('p1-score-label').textContent = `${p1Info.name}'s Score`;
    document.getElementById('p2-score-label').textContent = `${p2Info.name}'s Score`;

    document.getElementById('p1-score').textContent = gameState.scores.p1;
    document.getElementById('p2-score').textContent = gameState.scores.p2;
    
    document.getElementById('current-user-id').textContent = userId || 'N/A';
    document.getElementById('current-app-id').textContent = appId;
    
    // 2. Render Habits
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    if (gameState.habits.length === 0) {
        habitsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No habits defined yet.</p>';
    } else {
        gameState.habits.forEach((habit, index) => {
            const assigneeInfo = getPlayerInfo(habit.assignee);
            const habitElement = document.createElement('div');
            habitElement.className = `card p-4 rounded-xl flex justify-between items-center list-item-hover ${assigneeInfo.backgroundClass}`;
            
            habitElement.innerHTML = `
                <div class="flex-1">
                    <p class="text-sm text-gray-400">Assigned to: <span class="${assigneeInfo.colorClass} font-semibold">${assigneeInfo.name}</span></p>
                    <p class="text-lg font-semibold mt-1">${habit.description}</p>
                    <p class="text-sm text-gray-300">${habit.points} Points | ${habit.timesPerDay} Time(s) Per Day</p>
                </div>
                <div class="flex space-x-2 ml-4">
                    <button onclick="window.completeHabit(${index})" class="btn-primary px-3 py-1 text-sm rounded-lg font-sans font-semibold">Done</button>
                    <button onclick="window.removeHabit(${index})" class="text-gray-500 hover:text-red-500 transition px-2 py-1 text-sm font-sans">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            `;
            habitsList.appendChild(habitElement);
        });
    }

    // 3. Render Rewards
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No rewards defined yet.</p>';
    } else {
        gameState.rewards.forEach((reward, index) => {
            // Check if P1 or P2 can afford it
            const p1CanClaim = gameState.scores.p1 >= reward.cost;
            const p2CanClaim = gameState.scores.p2 >= reward.cost;
            
            const rewardElement = document.createElement('div');
            rewardElement.className = `card p-4 rounded-xl flex flex-col list-item-hover`;
            
            rewardElement.innerHTML = `
                <div class="flex justify-between items-start">
                    <h4 class="text-xl font-cinzel text-p2 mb-1">${reward.title}</h4>
                    <span class="text-2xl font-bold text-p2 ml-4">${reward.cost}</span>
                </div>
                <p class="text-gray-400 mb-3">${reward.description}</p>
                <div class="flex flex-col space-y-2 pt-2 border-t border-[#3c3c45] mt-3">
                    <p class="text-xs text-gray-500">Claimer:</p>
                    <div class="flex space-x-2">
                        <button onclick="window.claimReward(${index}, 'p1')" class="btn-secondary px-3 py-1 text-sm rounded-lg font-sans font-semibold flex-1 ${p1CanClaim ? 'hover:bg-p1-light border border-p1' : 'opacity-50 cursor-not-allowed'}" ${p1CanClaim ? '' : 'disabled'}>
                            ${p1Info.name} (${gameState.scores.p1})
                        </button>
                        <button onclick="window.claimReward(${index}, 'p2')" class="btn-secondary px-3 py-1 text-sm rounded-lg font-sans font-semibold flex-1 ${p2CanClaim ? 'hover:bg-p2-light border border-p2' : 'opacity-50 cursor-not-allowed'}" ${p2CanClaim ? '' : 'disabled'}>
                            ${p2Info.name} (${gameState.scores.p2})
                        </button>
                    </div>
                </div>
            `;
            rewardsList.appendChild(rewardElement);
        });
    }

    // 4. Render Punishments
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No punishments defined yet.</p>';
    } else {
        gameState.punishments.forEach((punishment, index) => {
            const punishmentElement = document.createElement('div');
            punishmentElement.className = `card p-4 rounded-xl flex justify-between items-start list-item-hover bg-p1-light`; // Use P1 color for definition
            
            punishmentElement.innerHTML = `
                <div class="flex-1">
                    <h4 class="text-xl font-cinzel text-p1 mb-1">${punishment.title}</h4>
                    <p class="text-gray-400">${punishment.description}</p>
                </div>
                <div class="ml-4">
                    <button onclick="window.removePunishment(${index})" class="text-gray-500 hover:text-red-500 transition px-2 py-1 text-sm font-sans">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            `;
            punishmentsList.appendChild(punishmentElement);
        });
    }

    // Hide loading, show app content
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
}


// --- Firebase Initialization ---

async function initFirebase() {
    // ... (Firebase initialization code remains the same)
    if (!firebaseConfig) {
        const errorMsg = "FATAL ERROR: Firebase configuration data is missing. Please ensure the global `__firebase_config` is defined.";
        document.getElementById('auth-error-message').textContent = errorMsg;
        console.error(errorMsg);
        return;
    }

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        await setPersistence(auth, browserLocalPersistence);

        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                if (!isInitialized) {
                    setupRealtimeListener();
                    isInitialized = true;
                }
            } else {
                userId = null;
                document.getElementById('auth-error-message').textContent = "Signed out. Waiting for authentication...";
            }
        });

    } catch (error) {
        const errorMsg = `Firebase Init Error: ${error.message}`;
        document.getElementById('auth-error-message').textContent = errorMsg;
        console.error(errorMsg);
    }
}

function setupRealtimeListener() {
    const docRef = doc(db, GAME_STATE_PATH);
    
    getDoc(docRef).then(docSnap => {
        if (!docSnap.exists()) {
            console.log("No ledger data found. Initializing new state...");
            saveState();
        }
    }).catch(e => {
        console.error("Error checking initial document existence:", e);
        showModal("Connection Error", "Failed to check ledger data existence.");
    });

    onSnapshot(docRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            gameState = {
                ...gameState,
                ...data,
                scores: { ...gameState.scores, ...data.scores },
                players: { ...gameState.players, ...data.players },
            };
        } else {
            console.warn("Ledger document does not exist. Reverting to default state.");
            gameState = {
                players: { p1: 'Player 1', p2: 'Player 2' },
                scores: { p1: 0, p2: 0 },
                habits: [], rewards: [], punishments: [], history: []
            };
            saveState();
        }
        renderState();
    }, (error) => {
        console.error("Real-time listener error:", error);
        showModal("Real-time Error", "Lost connection to the ledger. Changes may not update instantly.");
    });
}

// --- CORE APPLICATION LOGIC (Bound to Window) ---

/**
 * Toggles the main content tabs.
 * @param {'habits'|'rewards'|'punishments'} targetTab 
 */
window.switchTab = function(targetTab) {
    const tabs = ['habits', 'rewards', 'punishments'];
    tabs.forEach(tab => {
        const tabBtn = document.getElementById(`tab-${tab}`);
        const tabSection = document.getElementById(`${tab}-section`);
        
        if (tab === targetTab) {
            tabBtn.classList.add('active');
            tabSection.classList.remove('hidden');
        } else {
            tabBtn.classList.remove('active');
            tabSection.classList.add('hidden');
        }
    });
}

/**
 * Toggles the visibility of any form (habit, reward, or punishment).
 * @param {'habit'|'reward'|'punishment'} type 
 */
window.toggleForm = function(type) {
    const form = document.getElementById(`${type}-form`);
    const btn = document.getElementById(`toggle-${type}-btn`);
    form.classList.toggle('hidden');
    btn.textContent = form.classList.contains('hidden') ? '+' : '–';
}

/**
 * Updates a player's name and saves the state.
 * @param {'p1'|'p2'} playerType 
 * @param {string} newName 
 */
window.updatePlayerName = function(playerType, newName) {
    if (newName.trim()) {
        gameState.players[playerType] = newName.trim();
        saveState();
    }
}

/**
 * Adds a new habit to the ledger.
 */
window.addHabit = async function() {
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const times = parseInt(document.getElementById('new-habit-times').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value; // 'p1' or 'p2'

    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0) {
        showModal("Input Error", "Please complete all fields with valid positive values.");
        return;
    }
    
    gameState.habits.push({
        id: crypto.randomUUID(),
        description: desc,
        points: points,
        timesPerDay: times,
        assignee: assignee,
        createdAt: new Date().toISOString()
    });
    
    document.getElementById('new-habit-desc').value = '';
    document.getElementById('new-habit-points').value = 10;
    document.getElementById('new-habit-times').value = 1;
    window.toggleForm('habit');

    showModal("Success", "New Habit defined.");
    saveState();
}

/**
 * Marks a habit as complete, awards points, and saves the state.
 * @param {number} index - Index of the habit in the array.
 */
window.completeHabit = async function(index) {
    const habit = gameState.habits[index];
    if (!habit) return;

    const assigneeInfo = getPlayerInfo(habit.assignee);
    const message = `Confirm ${assigneeInfo.name} completed the habit: "${habit.description}" and earns ${habit.points} points?`;
    
    if (!await showModal("Confirm Habit Completion", message, true)) {
        return;
    }
    
    // Award points to the assignee ('p1' or 'p2')
    gameState.scores[habit.assignee] += habit.points;

    gameState.history.unshift({
        id: crypto.randomUUID(),
        type: 'completion',
        player: habit.assignee,
        points: habit.points,
        description: `Completed habit: ${habit.description}`,
        timestamp: serverTimestamp()
    });

    // Remove habit after completion
    gameState.habits.splice(index, 1);
    
    showModal("Points Awarded!", `${habit.points} points awarded to ${assigneeInfo.name}!`);
    saveState();
}

/**
 * Removes a habit without affecting scores.
 */
window.removeHabit = async function(index) {
    const habit = gameState.habits[index];
    if (!habit) return;

    const message = `Are you sure you want to delete the habit: "${habit.description}"?`;
    if (!await showModal("Confirm Deletion", message, true)) {
        return;
    }

    gameState.habits.splice(index, 1);
    showModal("Deleted", "Habit successfully removed.");
    saveState();
}


/**
 * Adds a new reward to the ledger.
 */
window.addReward = async function() {
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        showModal("Input Error", "Please complete all fields with valid positive values.");
        return;
    }

    gameState.rewards.push({
        id: crypto.randomUUID(),
        title: title,
        cost: cost,
        description: desc,
        createdAt: new Date().toISOString()
    });

    document.getElementById('new-reward-title').value = '';
    document.getElementById('new-reward-cost').value = 50;
    document.getElementById('new-reward-desc').value = '';
    window.toggleForm('reward');

    showModal("Success", "New Reward defined.");
    saveState();
}

/**
 * Claims a reward, deducts points, and saves the state.
 * @param {number} index - Index of the reward in the array.
 * @param {'p1'|'p2'} claimantId - The player claiming the reward.
 */
window.claimReward = async function(index, claimantId) {
    const reward = gameState.rewards[index];
    const claimantInfo = getPlayerInfo(claimantId);
    
    if (!reward) return;

    if (gameState.scores[claimantId] < reward.cost) {
        showModal("Insufficient Points", `${claimantInfo.name} only has ${gameState.scores[claimantId]} points, but the reward costs ${reward.cost}.`);
        return;
    }
    
    const message = `Do you confirm ${claimantInfo.name} wishes to claim "${reward.title}" for ${reward.cost} points?`;
    if (!await showModal("Confirm Claim", message, true)) {
        return;
    }

    // Deduct points
    gameState.scores[claimantId] -= reward.cost;

    // Log to history
    gameState.history.unshift({
        id: crypto.randomUUID(),
        type: 'reward',
        player: claimantId,
        points: -reward.cost,
        description: `Claimed reward: ${reward.title}`,
        timestamp: serverTimestamp()
    });

    // Remove reward after claiming
    gameState.rewards.splice(index, 1);
    
    showModal("Reward Claimed!", `${reward.title} claimed by ${claimantInfo.name}! ${reward.cost} points deducted.`);
    saveState();
}

/**
 * Adds a new punishment to the ledger.
 */
window.addPunishment = async function() {
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        showModal("Input Error", "Please provide a title and description for the punishment.");
        return;
    }

    gameState.punishments.push({
        id: crypto.randomUUID(),
        title: title,
        description: desc,
        createdAt: new Date().toISOString()
    });
    
    document.getElementById('new-punishment-title').value = '';
    document.getElementById('new-punishment-desc').value = '';
    window.toggleForm('punishment');

    showModal("Success", "New Punishment defined.");
    saveState();
}

/**
 * Removes a punishment.
 */
window.removePunishment = async function(index) {
    const punishment = gameState.punishments[index];
    if (!punishment) return;

    const message = `Are you sure you want to delete the punishment: "${punishment.title}"?`;
    if (!await showModal("Confirm Deletion", message, true)) {
        return;
    }

    gameState.punishments.splice(index, 1);
    showModal("Deleted", "Punishment successfully removed.");
    saveState();
}

/**
 * Shows the transaction history modal.
 */
window.showHistoryModal = function() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    
    if (gameState.history.length === 0) {
        historyList.innerHTML = '<p class="text-center py-4 text-gray-500 italic">No transactions recorded yet.</p>';
    } else {
        gameState.history.forEach(item => {
            const playerInfo = getPlayerInfo(item.player);
            const isReward = item.type === 'reward';
            const textClass = isReward ? 'text-p2' : 'text-p1';
            
            const itemElement = document.createElement('div');
            itemElement.className = `p-3 rounded-lg flex justify-between items-center border-l-4 ${isReward ? 'border-p2' : 'border-p1'} bg-[#1a1a1d]`;
            
            const date = item.timestamp && item.timestamp.toDate ? item.timestamp.toDate().toLocaleString() : 'Processing...';

            itemElement.innerHTML = `
                <div class="flex-1">
                    <p class="font-semibold ${textClass}">${isReward ? 'REWARD CLAIMED' : 'HABIT COMPLETE'}</p>
                    <p class="text-sm text-gray-400">${item.description}</p>
                    <p class="text-xs text-gray-500 mt-1">By: ${playerInfo.name} (${date})</p>
                </div>
                <span class="text-2xl font-bold ml-4 ${textClass}">${item.points > 0 ? '+' : ''}${item.points}</span>
            `;
            historyList.appendChild(itemElement);
        });
    }

    document.getElementById('history-modal').classList.remove('hidden');
}

/**
 * Hides the transaction history modal.
 */
window.hideHistoryModal = function() {
    document.getElementById('history-modal').classList.add('hidden');
}

/**
 * Inserts a random example. (Assumes EXAMPLE_DATABASE is global)
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
        document.getElementById('new-habit-times').value = 1;
        // Example habits were 'keeper'/'nightingale', map them to 'p1'/'p2'
        const assignee = example.type === 'keeper' ? 'p1' : 'p2'; 
        document.getElementById('new-habit-assignee').value = assignee;
        if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleForm('habit'); }
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        if (document.getElementById('reward-form').classList.contains('hidden')) { window.toggleForm('reward'); }
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        if (document.getElementById('punishment-form').classList.contains('hidden')) { window.toggleForm('punishment'); }
    }
}

// Redirect forbidden window.alert to custom modal
window.alert = function(message) {
    showModal("Notice", message);
}

// --- Initialization ---
window.onload = () => {
    initFirebase();
    // Default to the Habits tab on load
    window.switchTab('habits');
};