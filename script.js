import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    GoogleAuthProvider, 
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    onSnapshot, 
    setDoc, 
    updateDoc, 
    collection, 
    getDoc, 
    query, 
    where, 
    getDocs, 
    arrayUnion, 
    arrayRemove, 
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Variables (Provided by Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
// initialAuthToken is no longer used for persistent sign-in, but kept for compatibility.
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let userEmail = null; // Store user email for display/debugging
let selectedLedgerId = null;
let userRoleInLedger = null; // 'keeper' or 'nightingale'
let GAME_STATE_PATH = null; // Full path determined by selectedLedgerId
const GAME_STATE_DOC_ID = 'ledger_data';
const LEDGERS_COLLECTION_PATH = `/artifacts/${appId}/public/data/ledgers`;

let gameState = {
    // Initial state structure (will be overwritten by Firestore data)
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
    // New field to track users associated with this ledger
    users: []
};

// --- Utility Functions (Provided in the initial setup) ---

/**
 * Shows the custom modal/alert box.
 * @param {string} title - The title of the modal.
 * @param {string} body - The main content/message.
 */
window.showModal = function(title, body, actionsHtml = null) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    const actionsContainer = document.getElementById('modal-actions');
    actionsContainer.innerHTML = '';
    
    // Add custom actions if provided
    if (actionsHtml) {
        actionsContainer.innerHTML = actionsHtml;
    }
    
    // Always add a close button unless custom actions are used exclusively
    if (!actionsHtml || !actionsHtml.includes('closeModal()')) {
        const closeButton = document.createElement('button');
        closeButton.className = 'btn-secondary rounded-lg font-sans font-semibold';
        closeButton.textContent = 'Close';
        closeButton.onclick = window.closeModal;
        actionsContainer.appendChild(closeButton);
    }

    document.getElementById('modal-container').classList.remove('hidden');
    document.getElementById('modal-content').classList.remove('scale-90');
    document.getElementById('modal-content').classList.add('scale-100');
};

/**
 * Closes the custom modal/alert box.
 */
window.closeModal = function() {
    document.getElementById('modal-content').classList.remove('scale-100');
    document.getElementById('modal-content').classList.add('scale-90');
    setTimeout(() => {
        document.getElementById('modal-container').classList.add('hidden');
    }, 300);
};

/**
 * Generates an example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        showModal("Error", "Example data is not loaded correctly. Ensure examples.js is loaded.");
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
        window.toggleHabitForm(true); // Ensure visible
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        window.toggleRewardForm(true); // Ensure visible
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        window.togglePunishmentForm(true); // Ensure visible
    }
};

// --- Firebase Authentication Functions ---

/**
 * Handles user sign-in or registration with email and password.
 * @param {'signIn'|'signUp'} action 
 */
window.handleAuth = async function(action) {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    if (!email || !password) {
        showModal("Error", "Please enter both email and password.");
        return;
    }

    document.getElementById('auth-status').textContent = `Processing ${action}...`;
    try {
        if (action === 'signUp') {
            await createUserWithEmailAndPassword(auth, email, password);
            showModal("Success", "Account created successfully! You are now signed in.");
        } else {
            await signInWithEmailAndPassword(auth, email, password);
            showModal("Success", "Signed in successfully!");
        }
    } catch (error) {
        console.error("Authentication Error:", error);
        showModal("Authentication Failed", `Error: ${error.message}`);
    } finally {
        document.getElementById('auth-status').textContent = '';
    }
};

/**
 * Handles Google Sign-In using a popup.
 */
window.signInWithGoogle = async function() {
    const provider = new GoogleAuthProvider();
    document.getElementById('auth-status').textContent = `Signing in with Google...`;
    try {
        await signInWithPopup(auth, provider);
        showModal("Success", "Signed in with Google successfully!");
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        // User closed the popup or other error
        showModal("Authentication Failed", `Error: ${error.message}`);
    } finally {
        document.getElementById('auth-status').textContent = '';
    }
};

/**
 * Handles user sign out.
 */
window.signOutUser = async function() {
    try {
        await signOut(auth);
        // Reset state and show the auth screen
        selectedLedgerId = null;
        userRoleInLedger = null;
        GAME_STATE_PATH = null;
        gameState = { players: {}, scores: { keeper: 0, nightingale: 0 }, habits: [], rewards: [], punishments: [], users: [] };
        // The onAuthStateChanged listener handles the screen transition
        showModal("Signed Out", "You have been successfully signed out.");
    } catch (error) {
        console.error("Sign Out Error:", error);
        showModal("Sign Out Error", `Could not sign out: ${error.message}`);
    }
};

// --- Ledger Management Functions ---

/**
 * Shows the main authentication form.
 */
function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('auth-form').classList.remove('hidden');
    document.getElementById('ledger-selection').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('auth-status').textContent = 'Please sign in or register.';
}

/**
 * Fetches and displays ledgers the current user belongs to.
 */
window.showLedgerSelectionScreen = async function() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('auth-form').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('ledger-selection').classList.remove('hidden');
    document.getElementById('auth-status').textContent = `Welcome, ${userEmail || userId}!`;
    document.getElementById('my-ledgers').innerHTML = ''; // Clear existing list
    document.getElementById('ledger-loading-spinner').classList.remove('hidden');

    if (!userId) {
        showModal("Error", "User not authenticated. Please sign in again.");
        return;
    }

    try {
        // Query ledgers where the 'users' array contains an object with the current userId
        const q = query(collection(db, LEDGERS_COLLECTION_PATH), where("users", "array-contains", { userId: userId }));
        const querySnapshot = await getDocs(q);
        
        const ledgersListEl = document.getElementById('my-ledgers');
        ledgersListEl.innerHTML = '';
        
        if (querySnapshot.empty) {
            ledgersListEl.innerHTML = '<p class="text-center py-4 text-gray-500 italic">You are not part of any ledgers yet. Create one or join one below!</p>';
        } else {
            querySnapshot.forEach((doc) => {
                const ledger = doc.data();
                const ledgerId = doc.id;
                
                // Find the user's specific role in this ledger
                const userEntry = ledger.users.find(u => u.userId === userId);
                const role = userEntry ? userEntry.role : 'Observer'; // Should not happen if query works
                
                const otherUsers = ledger.users.filter(u => u.userId !== userId).length;
                
                const item = document.createElement('div');
                item.className = 'list-item p-4 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors flex justify-between items-center';
                item.onclick = () => window.selectLedger(ledgerId, role, ledger.name);
                item.innerHTML = `
                    <div>
                        <p class="text-lg font-semibold">${ledger.name}</p>
                        <p class="text-xs text-gray-400">Your Role: <span class="${role}-color font-semibold">${role.toUpperCase()}</span></p>
                        <p class="text-xs text-gray-500">Other Users: ${otherUsers}</p>
                    </div>
                    <button class="text-green-400 hover:text-green-300">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                `;
                ledgersListEl.appendChild(item);
            });
        }
    } catch (error) {
        console.error("Error fetching ledgers:", error);
        document.getElementById('my-ledgers').innerHTML = '<p class="text-red-400 text-center py-4">Error loading ledgers. See console for details.</p>';
    } finally {
        document.getElementById('ledger-loading-spinner').classList.add('hidden');
    }
};

/**
 * Creates a brand new ledger document in Firestore.
 */
window.handleCreateLedger = async function() {
    const name = document.getElementById('new-ledger-name').value.trim();
    const role = document.getElementById('new-ledger-role').value;

    if (!name || !role) {
        showModal("Invalid Input", "Please enter a name for the new ledger and select your initial role.");
        return;
    }

    const initialLedgerData = {
        name: name,
        users: [{ userId: userId, role: role }],
        createdAt: new Date().toISOString()
    };

    try {
        // 1. Create the main Ledger document in the public collection
        const ledgerRef = doc(collection(db, LEDGERS_COLLECTION_PATH));
        await setDoc(ledgerRef, initialLedgerData);
        const newLedgerId = ledgerRef.id;

        // 2. Initialize the game state document inside this new ledger's path
        const gamePath = `${LEDGERS_COLLECTION_PATH}/${newLedgerId}/${GAME_STATE_DOC_ID}`;
        const initialGameState = {
            players: {
                keeper: role === 'keeper' ? userEmail || userId : 'Other User',
                nightingale: role === 'nightingale' ? userEmail || userId : 'Other User'
            },
            scores: { keeper: 0, nightingale: 0 },
            habits: [],
            rewards: [],
            punishments: [],
            users: initialLedgerData.users
        };

        await setDoc(doc(db, gamePath), initialGameState);

        showModal("Ledger Created!", `Ledger "${name}" has been created. Your ID is now associated with it.`);
        
        // Automatically select the new ledger
        window.selectLedger(newLedgerId, role, name);

    } catch (error) {
        console.error("Error creating ledger:", error);
        showModal("Creation Failed", `Could not create the ledger: ${error.message}`);
    }
};

/**
 * Adds the current user to an existing ledger.
 */
window.handleJoinLedger = async function() {
    const ledgerId = document.getElementById('join-ledger-id').value.trim();
    const role = document.getElementById('join-ledger-role').value;

    if (!ledgerId || !role) {
        showModal("Invalid Input", "Please enter a Ledger ID and select your role.");
        return;
    }
    
    const ledgerRef = doc(db, LEDGERS_COLLECTION_PATH, ledgerId);

    try {
        const ledgerDoc = await getDoc(ledgerRef);
        if (!ledgerDoc.exists()) {
            showModal("Not Found", "The provided Ledger ID does not exist.");
            return;
        }

        const ledgerData = ledgerDoc.data();
        const userExists = ledgerData.users.some(u => u.userId === userId);

        if (userExists) {
            showModal("Already Member", "You are already a member of this ledger. You can select it from 'My Ledgers'.");
            return;
        }
        
        // Use a batch to update both the ledger metadata and the main game state in one go
        const batch = writeBatch(db);

        // 1. Update the main ledger document (metadata)
        batch.update(ledgerRef, {
            users: arrayUnion({ userId: userId, role: role })
        });

        // 2. Update the main game state document to reflect the new user
        const gamePath = `${LEDGERS_COLLECTION_PATH}/${ledgerId}/${GAME_STATE_DOC_ID}`;
        const gameRef = doc(db, gamePath);
        
        const newPlayerName = userEmail || userId.substring(0, 8); // Use email or truncated ID as placeholder name
        const updateObject = {};
        if (role === 'keeper') {
             updateObject['players.keeper'] = newPlayerName;
        } else {
             updateObject['players.nightingale'] = newPlayerName;
        }
        updateObject['users'] = arrayUnion({ userId: userId, role: role });
        
        batch.update(gameRef, updateObject);
        
        await batch.commit();

        showModal("Joined!", `Successfully joined Ledger: ${ledgerData.name} as ${role.toUpperCase()}.`);
        
        // Select the joined ledger
        window.selectLedger(ledgerId, role, ledgerData.name);

    } catch (error) {
        console.error("Error joining ledger:", error);
        showModal("Join Failed", `Could not join the ledger: ${error.message}`);
    }
};


/**
 * Sets the active ledger and transitions to the main game view.
 * @param {string} ledgerId - The ID of the ledger document.
 * @param {string} role - The user's role in this ledger ('keeper' or 'nightingale').
 * @param {string} name - The name of the ledger.
 */
window.selectLedger = function(ledgerId, role, name) {
    selectedLedgerId = ledgerId;
    userRoleInLedger = role;
    GAME_STATE_PATH = `${LEDGERS_COLLECTION_PATH}/${selectedLedgerId}/${GAME_STATE_DOC_ID}`;
    
    // Update display elements
    document.getElementById('ledger-title-display').textContent = name || 'The Ledger';
    document.getElementById('ledger-role-display').innerHTML = `Logged in as: <span class="${role}-color font-semibold">${role.toUpperCase()}</span>`;

    // Hide auth screen and show main content
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');

    // Start listening for game state changes in the new path
    startLedgerListener();
};


// --- Firebase Initialization and Auth Listener ---

function initializeFirebase() {
    if (!firebaseConfig) {
        showModal("Configuration Error", "Firebase configuration is missing. Cannot initialize application.");
        return;
    }
    
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    // Set up real-time authentication listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in
            userId = user.uid;
            userEmail = user.email || 'N/A';
            document.getElementById('current-user-id').textContent = userId;
            document.getElementById('current-app-id').textContent = appId;
            
            // Show ledger selection screen upon successful login
            window.showLedgerSelectionScreen();

        } else {
            // User is signed out
            userId = null;
            userEmail = null;
            document.getElementById('current-user-id').textContent = 'Not Signed In';
            
            // If the user was in a ledger, reset the UI
            if (selectedLedgerId) {
                // Stop listening to the previous ledger
                // (Note: The listener cleanup logic would be here if implemented, but we rely on onSnapshot returning its own unsubscribe function)
                selectedLedgerId = null;
                // Re-initialize all lists to empty state
                renderHabits([]);
                renderRewards([]);
                renderPunishments([]);
            }
            
            // Show the authentication screen
            showAuthScreen();
        }
    });
}

// --- Ledger Listeners and Handlers ---

// Variable to hold the unsubscribe function for the Firestore listener
let unsubscribeLedgerListener = null;

function startLedgerListener() {
    if (!GAME_STATE_PATH) {
        console.error("Attempted to start listener without a valid GAME_STATE_PATH.");
        return;
    }
    
    // Stop the previous listener if it exists
    if (unsubscribeLedgerListener) {
        unsubscribeLedgerListener();
    }

    const docRef = doc(db, GAME_STATE_PATH);
    
    // Start the new listener
    unsubscribeLedgerListener = onSnapshot(docRef, (doc) => {
        if (doc.exists()) {
            gameState = doc.data();
            updateUIGameState();
            console.log("Game state updated from Firestore.");
        } else {
            // This case should ideally not happen if ledger creation/joining is correct
            console.warn("No game state found at path: " + GAME_STATE_PATH);
            showModal("Error", "The game state for this ledger could not be found or has been deleted.");
        }
    }, (error) => {
        console.error("Firestore Listener Error:", error);
        showModal("Connection Error", `Failed to listen for updates: ${error.message}`);
    });
}

function updateUIGameState() {
    // 1. Update Scores
    document.getElementById('keeper-score').textContent = gameState.scores.keeper;
    document.getElementById('nightingale-score').textContent = gameState.scores.nightingale;

    // 2. Update Player Names (using email or ID for now)
    document.getElementById('keeper-player-name').textContent = gameState.players.keeper || 'Keeper';
    document.getElementById('nightingale-player-name').textContent = gameState.players.nightingale || 'Nightingale';

    // 3. Render Lists
    renderHabits(gameState.habits);
    renderRewards(gameState.rewards);
    renderPunishments(gameState.punishments);
}

// --- Game State Update Functions ---

/**
 * Saves the current local gameState object back to Firestore.
 */
async function saveGameState() {
    if (!GAME_STATE_PATH) {
        showModal("Error", "No ledger selected. Please select a ledger first.");
        return;
    }
    try {
        await setDoc(doc(db, GAME_STATE_PATH), gameState);
        console.log("Game state saved.");
    } catch (error) {
        console.error("Error saving game state:", error);
        showModal("Save Error", `Failed to save game state: ${error.message}`);
    }
}

/**
 * Updates a player's score and saves the state.
 * @param {'keeper'|'nightingale'} player 
 * @param {number} delta 
 */
window.updateScore = function(player, delta) {
    if (!GAME_STATE_PATH) {
        showModal("Error", "No ledger selected. Please select a ledger first.");
        return;
    }
    gameState.scores[player] = Math.max(0, gameState.scores[player] + delta);
    saveGameState();
};


// --- Habit Management ---

window.addHabit = function() {
    if (!GAME_STATE_PATH) { showModal("Error", "No ledger selected."); return; }
    const description = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value, 10);
    const timesPerWeek = parseInt(document.getElementById('new-habit-times').value, 10);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!description || isNaN(points) || isNaN(timesPerWeek) || points <= 0 || timesPerWeek <= 0) {
        showModal("Invalid Input", "Please provide a description, valid points, and times per week.");
        return;
    }

    const newHabit = {
        id: crypto.randomUUID(),
        description: description,
        points: points,
        timesPerWeek: timesPerWeek,
        assignee: assignee,
        completions: 0 // Track weekly completions
    };

    gameState.habits.push(newHabit);
    saveGameState();
    window.toggleHabitForm(false); // Hide form
};

window.renderHabits = function(habits) {
    const listEl = document.getElementById('habits-list');
    listEl.innerHTML = ''; // Clear list
    
    if (habits.length === 0) {
        listEl.innerHTML = '<p class="text-center py-4 text-gray-500 italic" id="habits-loading">No habits defined yet.</p>';
        return;
    }

    habits.forEach(habit => {
        const item = document.createElement('div');
        const assigneeRole = habit.assignee;
        const buttonClass = assigneeRole === 'keeper' ? 'keeper-color' : 'nightingale-color';

        item.className = 'list-item p-4 rounded-lg flex justify-between items-center';
        item.innerHTML = `
            <div>
                <p class="font-semibold">${habit.description}</p>
                <p class="text-sm text-gray-400">
                    <span class="${buttonClass} font-bold">${habit.points} pts</span> / <span class="text-gray-500">${habit.timesPerWeek} times/wk</span>
                </p>
            </div>
            <div class="flex items-center space-x-3">
                <button onclick="window.completeHabit('${habit.id}', '${assigneeRole}')" class="text-2xl ${buttonClass} hover:opacity-75 transition-opacity">
                    <i class="fas fa-check-circle"></i>
                </button>
                <button onclick="window.removeHabit('${habit.id}')" class="text-gray-500 hover:text-red-500 transition-colors">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        listEl.appendChild(item);
    });
};

window.completeHabit = function(habitId, assigneeRole) {
    const habit = gameState.habits.find(h => h.id === habitId);
    if (habit) {
        // Increment score of the opposite player
        const scoreRecipient = assigneeRole === 'keeper' ? 'nightingale' : 'keeper';
        window.updateScore(scoreRecipient, habit.points);
        showModal("Habit Completed!", `+${habit.points} points awarded to the ${scoreRecipient.toUpperCase()}.`);
    } else {
        showModal("Error", "Habit not found.");
    }
};

window.removeHabit = function(habitId) {
    gameState.habits = gameState.habits.filter(h => h.id !== habitId);
    saveGameState();
};

window.toggleHabitForm = function(show) {
    const form = document.getElementById('habit-form');
    if (show === undefined) {
        form.classList.toggle('hidden');
    } else if (show) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
};


// --- Reward Management ---

window.addReward = function() {
    if (!GAME_STATE_PATH) { showModal("Error", "No ledger selected."); return; }
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value, 10);
    const description = document.getElementById('new-reward-desc').value.trim();

    if (!title || !description || isNaN(cost) || cost <= 0) {
        showModal("Invalid Input", "Please provide a title, description, and valid point cost.");
        return;
    }

    const newReward = {
        id: crypto.randomUUID(),
        title: title,
        cost: cost,
        description: description
    };

    gameState.rewards.push(newReward);
    saveGameState();
    window.toggleRewardForm(false);
};

window.renderRewards = function(rewards) {
    const listEl = document.getElementById('rewards-list');
    listEl.innerHTML = '';
    
    if (rewards.length === 0) {
        listEl.innerHTML = '<p class="text-center py-4 text-gray-500 italic" id="rewards-loading">No rewards defined yet.</p>';
        return;
    }

    rewards.forEach(reward => {
        const item = document.createElement('div');
        item.className = 'list-item p-4 rounded-lg flex justify-between items-center';
        item.innerHTML = `
            <div>
                <p class="font-semibold">${reward.title}</p>
                <p class="text-sm text-gray-400">${reward.description}</p>
            </div>
            <button onclick="window.purchaseReward('${reward.id}', ${reward.cost})" class="btn-primary rounded-lg text-sm px-3 py-1 font-sans font-semibold">
                ${reward.cost} pts
            </button>
        `;
        listEl.appendChild(item);
    });
};

window.purchaseReward = function(rewardId, cost) {
    if (userRoleInLedger !== 'nightingale') {
         showModal("Permission Denied", "Only the NIGHTINGALE can purchase rewards.");
         return;
    }
    
    const currentScore = gameState.scores.nightingale;
    if (currentScore < cost) {
        showModal("Insufficient Points", `You need ${cost} points to purchase this, but only have ${currentScore}.`);
        return;
    }

    const reward = gameState.rewards.find(r => r.id === rewardId);
    if (reward) {
        window.showModal(
            `Confirm Purchase: ${reward.title}`, 
            `Are you sure you want to spend ${cost} points on this reward? Your score will drop from ${currentScore} to ${currentScore - cost}.`,
            `<button onclick="window.confirmPurchase('${rewardId}', ${cost})" class="btn-primary rounded-lg font-sans font-semibold">Confirm</button>`
        );
    } else {
        showModal("Error", "Reward not found.");
    }
};

window.confirmPurchase = function(rewardId, cost) {
    const rewardIndex = gameState.rewards.findIndex(r => r.id === rewardId);
    if (rewardIndex !== -1) {
        // Deduct points
        window.updateScore('nightingale', -cost);
        
        // Remove reward (optional, but logical for one-time rewards)
        gameState.rewards.splice(rewardIndex, 1);
        saveGameState();
        
        window.closeModal();
        showModal("Reward Claimed!", `Successfully purchased ${reward.title} for ${cost} points. Score deducted.`);
    } else {
        window.closeModal();
        showModal("Error", "Reward was already claimed or not found.");
    }
};

window.toggleRewardForm = function(show) {
    const form = document.getElementById('reward-form');
    if (show === undefined) {
        form.classList.toggle('hidden');
    } else if (show) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
};


// --- Punishment Management ---

window.addPunishment = function() {
    if (!GAME_STATE_PATH) { showModal("Error", "No ledger selected."); return; }
    const title = document.getElementById('new-punishment-title').value.trim();
    const description = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !description) {
        showModal("Invalid Input", "Please provide a title and description for the punishment.");
        return;
    }

    const newPunishment = {
        id: crypto.randomUUID(),
        title: title,
        description: description,
        assignedTo: null // 'keeper' or 'nightingale'
    };

    gameState.punishments.push(newPunishment);
    saveGameState();
    window.togglePunishmentForm(false);
};

window.renderPunishments = function(punishments) {
    const listEl = document.getElementById('punishments-list');
    listEl.innerHTML = '';
    
    if (punishments.length === 0) {
        listEl.innerHTML = '<p class="text-center py-4 text-gray-500 italic" id="punishments-loading">No punishments defined yet.</p>';
        return;
    }

    punishments.forEach(punishment => {
        const item = document.createElement('div');
        item.className = 'list-item p-4 rounded-lg flex justify-between items-center';
        
        let actions = `
            <div class="flex items-center space-x-3">
                <button onclick="window.assignPunishment('${punishment.id}', 'keeper')" class="btn-secondary rounded-lg text-xs px-3 py-1 hover:bg-gray-600 transition-colors">Assign to Keeper</button>
                <button onclick="window.assignPunishment('${punishment.id}', 'nightingale')" class="btn-secondary rounded-lg text-xs px-3 py-1 hover:bg-gray-600 transition-colors">Assign to Nightingale</button>
                <button onclick="window.removePunishment('${punishment.id}')" class="text-gray-500 hover:text-red-500 transition-colors">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        
        let titleClass = 'font-semibold';
        let status = '';

        if (punishment.assignedTo) {
            titleClass = 'font-bold line-through text-gray-500';
            status = `<p class="text-sm text-red-400 mt-1">ASSIGNED to ${punishment.assignedTo.toUpperCase()}</p>`;
            actions = `<button onclick="window.removePunishment('${punishment.id}')" class="text-gray-500 hover:text-red-500 transition-colors">
                <i class="fas fa-trash-alt"></i>
            </button>`;
        }
        
        item.innerHTML = `
            <div>
                <p class="${titleClass}">${punishment.title}</p>
                <p class="text-sm text-gray-400">${punishment.description}</p>
                ${status}
            </div>
            ${actions}
        `;
        listEl.appendChild(item);
    });
};

window.assignPunishment = function(punishmentId, assignedTo) {
    const punishment = gameState.punishments.find(p => p.id === punishmentId);
    if (punishment) {
        punishment.assignedTo = assignedTo;
        saveGameState();
        showModal("Punishment Assigned", `${punishment.title} has been assigned to the ${assignedTo.toUpperCase()}.`);
    } else {
        showModal("Error", "Punishment not found.");
    }
};

window.removePunishment = function(punishmentId) {
    gameState.punishments = gameState.punishments.filter(p => p.id !== punishmentId);
    saveGameState();
};

window.togglePunishmentForm = function(show) {
    const form = document.getElementById('punishment-form');
    if (show === undefined) {
        form.classList.toggle('hidden');
    } else if (show) {
        form.classList.remove('hidden');
    } else {
        form.classList.add('hidden');
    }
};


// --- Application Start ---
initializeFirebase();