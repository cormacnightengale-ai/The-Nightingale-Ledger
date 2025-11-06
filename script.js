import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---
// EXAMPLE_DATABASE is expected to be loaded globally from examples.js
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
    history: []
};
const COLLECTION_NAMES = ['habits', 'rewards', 'punishments'];

// --- Utility Functions ---

/**
 * Creates and displays a custom modal message box.
 * @param {string} title - The title of the modal.
 * @param {string} message - The message content.
 */
window.showModal = function(title, message) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    modal.classList.remove('hidden');
}

/**
 * Hides the custom modal.
 */
window.hideModal = function() {
    document.getElementById('custom-modal').classList.add('hidden');
}

/**
 * Handles errors by logging them and showing a modal to the user.
 * @param {Error} e - The error object.
 * @param {string} userMessage - A friendly message to show the user.
 */
function handleError(e, userMessage) {
    console.error(userMessage, e);
    // Ensure we handle the case where we can't show a modal (e.g., initial load errors)
    try {
        window.showModal("Error", `${userMessage}: ${e.message}`);
    } catch (err) {
        console.error("Failed to show error modal:", err);
    }
}

/**
 * Toggles visibility of the modal for adding new habits.
 */
window.toggleHabitForm = function() {
    document.getElementById('new-habit-form').classList.toggle('hidden');
    document.getElementById('add-habit-btn').classList.toggle('hidden');
}

/**
 * Toggles visibility of the modal for adding new rewards.
 */
window.toggleRewardForm = function() {
    document.getElementById('new-reward-form').classList.toggle('hidden');
    document.getElementById('add-reward-btn').classList.toggle('hidden');
}

/**
 * Toggles visibility of the modal for adding new punishments.
 */
window.togglePunishmentForm = function() {
    document.getElementById('new-punishment-form').classList.toggle('hidden');
    document.getElementById('add-punishment-btn').classList.toggle('hidden');
}

// --- Rendering Functions ---

/**
 * Renders the current game state to the DOM.
 */
function renderGameState() {
    try {
        // Player Names and IDs
        document.getElementById('player-id-display').innerText = `Your ID: ${userId || '...loading'}`;
        document.getElementById('keeper-name').innerText = gameState.players.keeper;
        document.getElementById('nightingale-name').innerText = gameState.players.nightingale;

        // Scores
        document.getElementById('keeper-score').innerText = gameState.scores.keeper;
        document.getElementById('nightingale-score').innerText = gameState.scores.nightingale;

        // Data Lists
        renderList('habits', gameState.habits);
        renderList('rewards', gameState.rewards);
        renderList('punishments', gameState.punishments);
        renderHistory(gameState.history);

    } catch (e) {
        handleError(e, "Failed to render game state");
    }
}

/**
 * Renders a dynamic list of items (habits, rewards, or punishments).
 * @param {string} collectionName - 'habits', 'rewards', or 'punishments'.
 * @param {Array<Object>} items - The list of items to render.
 */
function renderList(collectionName, items) {
    const listElement = document.getElementById(`${collectionName}-list`);
    if (!listElement) return;

    listElement.innerHTML = ''; // Clear previous content

    if (items.length === 0) {
        listElement.innerHTML = `<p class="text-sm italic text-gray-500 p-4">No ${collectionName} defined yet.</p>`;
        return;
    }

    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center p-3 border-b border-zinc-700 hover:bg-zinc-800 transition duration-150';

        let content = '';
        let button = '';
        const idString = item.id.substring(0, 8); // Short ID for display

        if (collectionName === 'habits') {
            content = `
                <div>
                    <p class="font-semibold text-zinc-300">${item.description}</p>
                    <p class="text-xs text-zinc-500 mt-1">
                        +${item.points} points | ${item.type.charAt(0).toUpperCase() + item.type.slice(1)} | ${item.times}/day | ID: ${idString}
                    </p>
                </div>
            `;
            button = `
                <button onclick="logHabitCompletion('${item.id}', '${item.type}', ${item.points})" class="ml-4 p-2 text-xs font-bold text-green-300 border border-green-700 hover:bg-green-900 rounded-full transition duration-150">
                    <i class="fas fa-check"></i> Complete
                </button>
            `;
        } else if (collectionName === 'rewards') {
            content = `
                <div>
                    <p class="font-semibold text-zinc-300">${item.title}</p>
                    <p class="text-xs text-zinc-500 mt-1">${item.description} | Cost: ${item.cost} | ID: ${idString}</p>
                </div>
            `;
            button = `
                <button onclick="redeemReward('${item.id}', ${item.cost})" class="ml-4 p-2 text-xs font-bold text-yellow-300 border border-yellow-700 hover:bg-yellow-900 rounded-full transition duration-150">
                    <i class="fas fa-star"></i> Redeem
                </button>
            `;
        } else if (collectionName === 'punishments') {
            content = `
                <div>
                    <p class="font-semibold text-zinc-300">${item.title}</p>
                    <p class="text-xs text-zinc-500 mt-1">${item.description} | ID: ${idString}</p>
                </div>
            `;
            button = `
                <button onclick="logPunishmentAssignment('${item.id}')" class="ml-4 p-2 text-xs font-bold text-red-300 border border-red-700 hover:bg-red-900 rounded-full transition duration-150">
                    <i class="fas fa-gavel"></i> Assign
                </button>
            `;
        }

        // Add delete button for all items (for admin/editing)
        const deleteButton = `
            <button onclick="deleteItem('${collectionName}', '${item.id}')" class="ml-2 text-red-500 hover:text-red-300 transition duration-150" aria-label="Delete Item">
                <i class="fas fa-times"></i>
            </button>
        `;

        li.innerHTML = `${content} <div class="flex items-center">${button} ${deleteButton}</div>`;
        listElement.appendChild(li);
    });
}

/**
 * Renders the history log.
 * @param {Array<Object>} history - The list of history entries.
 */
function renderHistory(history) {
    const historyElement = document.getElementById('history-log');
    if (!historyElement) return;
    historyElement.innerHTML = ''; // Clear previous content

    const reversedHistory = [...history].reverse(); // Show newest first

    if (reversedHistory.length === 0) {
        historyElement.innerHTML = `<p class="text-sm italic text-gray-500 p-4">The ledger is empty.</p>`;
        return;
    }

    reversedHistory.slice(0, 10).forEach(entry => {
        const li = document.createElement('li');
        li.className = 'p-2 border-b border-zinc-700 text-sm';
        const date = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        let colorClass = 'text-zinc-400';
        if (entry.type === 'completion') colorClass = 'text-green-400';
        if (entry.type === 'redemption') colorClass = 'text-yellow-400';
        if (entry.type === 'punishment') colorClass = 'text-red-400';

        li.innerHTML = `<span class="text-xs text-zinc-600 mr-2">[${date}]</span> <span class="${colorClass}">${entry.message}</span>`;
        historyElement.appendChild(li);
    });
}


// --- Firebase Logic and Initialization ---

/**
 * Initializes Firebase, authenticates the user, and sets up the real-time listener.
 */
async function initializeFirebase() {
    try {
        if (!firebaseConfig) {
            handleError(new Error("Firebase configuration is missing."), "Cannot initialize Firebase.");
            return;
        }
        
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // Set log level for debugging
        // if (typeof setLogLevel !== 'undefined') { setLogLevel('Debug'); }

        // Authentication and user ID setup
        await new Promise(resolve => {
            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                } else {
                    // Sign in with custom token if available, otherwise anonymously
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                    userId = auth.currentUser.uid;
                }
                // Construct the path for public data (shared between all users of this app)
                GAME_STATE_PATH = `artifacts/${appId}/public/data/ledger_state`;
                resolve();
            });
        });

        // Initialize game state document if it doesn't exist
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            await setDoc(docRef, gameState);
            console.log("Initial game state document created.");
        } else {
            // Apply a default check for user names in case they haven't been set
            const currentData = docSnap.data();
            if (currentData.players.keeper === 'User 1' && currentData.players.nightingale === 'User 2') {
                // If the default names are still there, assign the current user ID to 'Keeper' as a temporary default
                currentData.players.keeper = `Keeper (${userId.substring(0, 8)})`;
                currentData.players.nightingale = `Nightingale (${userId.substring(0, 8)})`;
                await updateDoc(docRef, { players: currentData.players });
            }
        }

        // Set up real-time listener
        onSnapshot(docRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                gameState = docSnapshot.data();
                renderGameState();
                console.log("Game state updated from Firestore.");
            } else {
                // This should not happen if we initialized it, but good to handle
                console.warn("Game state document does not exist after initialization.");
            }
        }, (error) => {
            handleError(error, "Error listening to game state updates");
        });

    } catch (e) {
        handleError(e, "Firebase Initialization Failed");
    }
}

// --- Action Logic (Habits, Rewards, Punishments) ---

/**
 * Generates a random example habit, reward, or punishment into the form fields.
 * This function relies on EXAMPLE_DATABASE being loaded globally from examples.js.
 * @param {string} type - 'habit', 'reward', or 'punishment'.
 */
window.generateExample = function(type) {
    // Check if the global EXAMPLE_DATABASE is available (from examples.js)
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        window.showModal("Error", "Example data is not loaded correctly. Ensure examples.js is loaded first.");
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

/**
 * Logs the completion of a habit, updates the score, and logs to history.
 * @param {string} habitId - The ID of the completed habit.
 * @param {string} playerType - 'keeper' or 'nightingale'.
 * @param {number} points - The points to award.
 */
window.logHabitCompletion = async function(habitId, playerType, points) {
    if (!db || !GAME_STATE_PATH) return handleError(null, "Database not initialized.");
    
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);

    // Find the habit description for the log message
    const habit = gameState.habits.find(h => h.id === habitId);
    if (!habit) return window.showModal("Error", "Habit not found in current state.");

    const newScore = (gameState.scores[playerType] || 0) + points;
    const message = `${gameState.players[playerType]} earned ${points} points for completing: "${habit.description}"`;
    const newHistoryEntry = { message, timestamp: Date.now(), type: 'completion' };

    try {
        await updateDoc(docRef, {
            [`scores.${playerType}`]: newScore,
            history: [...gameState.history, newHistoryEntry]
        });
        window.showModal("Habit Complete", `+${points} awarded to ${gameState.players[playerType]}`);
    } catch (e) {
        handleError(e, "Failed to log habit completion");
    }
}

/**
 * Redeems a reward, deducts the cost from the current user's score, and logs to history.
 * Assumes the user is the 'Keeper' for score deduction logic simplification in this multi-user single-state app.
 * NOTE: For a true multi-player app, a more robust role system is needed.
 * @param {string} rewardId - The ID of the reward to redeem.
 * @param {number} cost - The cost of the reward.
 */
window.redeemReward = async function(rewardId, cost) {
    if (!db || !GAME_STATE_PATH) return handleError(null, "Database not initialized.");

    const playerType = 'keeper'; // Assuming Keeper is the primary player managing the score/rewards
    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    const currentScore = gameState.scores[playerType] || 0;

    if (currentScore < cost) {
        return window.showModal("Insufficient Funds", `${gameState.players[playerType]} needs ${cost - currentScore} more points to redeem this reward.`);
    }

    // Find the reward title for the log message
    const reward = gameState.rewards.find(r => r.id === rewardId);
    if (!reward) return window.showModal("Error", "Reward not found in current state.");

    const newScore = currentScore - cost;
    const message = `${gameState.players[playerType]} redeemed "${reward.title}" for ${cost} points.`;
    const newHistoryEntry = { message, timestamp: Date.now(), type: 'redemption' };

    try {
        await updateDoc(docRef, {
            [`scores.${playerType}`]: newScore,
            history: [...gameState.history, newHistoryEntry]
        });
        window.showModal("Reward Redeemed", `Redeemed: ${reward.title}. New score: ${newScore}`);
    } catch (e) {
        handleError(e, "Failed to redeem reward");
    }
}

/**
 * Logs the assignment of a punishment. Does not affect points in this version.
 * @param {string} punishmentId - The ID of the punishment assigned.
 */
window.logPunishmentAssignment = async function(punishmentId) {
    if (!db || !GAME_STATE_PATH) return handleError(null, "Database not initialized.");

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    
    // Find the punishment title for the log message
    const punishment = gameState.punishments.find(p => p.id === punishmentId);
    if (!punishment) return window.showModal("Error", "Punishment not found in current state.");

    const message = `A punishment has been assigned: "${punishment.title}"`;
    const newHistoryEntry = { message, timestamp: Date.now(), type: 'punishment' };

    try {
        await updateDoc(docRef, {
            history: [...gameState.history, newHistoryEntry]
        });
        window.showModal("Punishment Assigned", `Assigned: ${punishment.title}.`);
    } catch (e) {
        handleError(e, "Failed to assign punishment");
    }
}

/**
 * Saves a new habit to Firestore.
 */
window.saveNewHabit = async function() {
    if (!db || !GAME_STATE_PATH) return handleError(null, "Database not initialized.");

    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const times = parseInt(document.getElementById('new-habit-times').value, 10);
    const type = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0 || !['keeper', 'nightingale'].includes(type)) {
        return window.showModal("Validation Error", "Please ensure all habit fields are valid (Description, Points > 0, Times > 0, Assignee).");
    }

    const newHabit = {
        id: crypto.randomUUID(),
        description: desc,
        points: points,
        times: times,
        type: type, // 'keeper' or 'nightingale'
    };

    try {
        const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
        await updateDoc(docRef, {
            habits: [...gameState.habits, newHabit]
        });
        // Clear form and hide
        document.getElementById('new-habit-desc').value = '';
        document.getElementById('new-habit-points').value = 10;
        document.getElementById('new-habit-times').value = 1;
        toggleHabitForm();
        showModal("Success", "New habit added!");
    } catch (e) {
        handleError(e, "Failed to add habit");
    }
}

/**
 * Saves a new reward to Firestore.
 */
window.saveNewReward = async function() {
    if (!db || !GAME_STATE_PATH) return handleError(null, "Database not initialized.");

    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const desc = document.getElementById('new-reward-desc').value.trim();

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        return window.showModal("Validation Error", "Please ensure all reward fields are valid (Title, Description, Cost > 0).");
    }

    const newReward = {
        id: crypto.randomUUID(),
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
        document.getElementById('new-reward-cost').value = 50;
        document.getElementById('new-reward-desc').value = '';
        toggleRewardForm();
        showModal("Success", "New reward added!");
    } catch (e) {
        handleError(e, "Failed to add reward");
    }
}

/**
 * Saves a new punishment to Firestore.
 */
window.saveNewPunishment = async function() {
    if (!db || !GAME_STATE_PATH) return handleError(null, "Database not initialized.");

    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        return window.showModal("Validation Error", "Please ensure all punishment fields are complete (Title and Description).");
    }

    const newPunishment = {
        id: crypto.randomUUID(),
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
 * Deletes an item (habit, reward, or punishment) by ID.
 * @param {string} collectionName - 'habits', 'rewards', or 'punishments'.
 * @param {string} itemId - The ID of the item to delete.
 */
window.deleteItem = async function(collectionName, itemId) {
    if (!db || !GAME_STATE_PATH) return handleError(null, "Database not initialized.");

    const docRef = doc(db, GAME_STATE_PATH, GAME_STATE_DOC_ID);
    const currentItems = [...gameState[collectionName]];
    const updatedItems = currentItems.filter(item => item.id !== itemId);

    try {
        // Use a dynamic property name for the update
        const updatePayload = {};
        updatePayload[collectionName] = updatedItems;

        await updateDoc(docRef, updatePayload);
        showModal("Item Removed", `Item removed from ${collectionName}.`);
    } catch (e) {
        handleError(e, `Failed to remove item from ${collectionName}`);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initializeFirebase);
