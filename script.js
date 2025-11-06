import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, getDoc, runTransaction, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; // For debugging

// Set Firestore log level to debug for development
setLogLevel('debug');

// --- Global Variables (Provided by Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nightingale-ledger-v1';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Firebase/App State ---
let app;
let db;
let auth;
let userId = null;
let ledgerId = null; // The Ledger's unique ID (Room Code/Phrase)
let GAME_STATE_PATH = null; 
const GAME_STATE_DOC_ID = 'ledger_data';
let currentRole = null; // 'keeper' or 'nightingale'
let currentLayout = localStorage.getItem('appLayout') || 'modern'; // 'modern' or 'classic'

let gameState = {
    players: {
        keeper: { name: 'User 1', id: '---', status: 'Awaiting...' },
        nightingale: { name: 'User 2', id: '---', status: 'Awaiting...' }
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
 * Custom modal implementation for alerts and notices (replaces window.alert)
 */
window.showModal = function(type, role) {
    // Hide all modals first
    document.getElementById('edit-profile-modal').classList.add('hidden');
    document.getElementById('generic-modal').classList.add('hidden');
    document.getElementById('options-modal').classList.add('hidden');
    
    if (type === 'generic') {
        document.getElementById('generic-modal').classList.remove('hidden');
    } else if (type === 'edit-profile') {
        currentRole = role;
        document.getElementById('modal-role-title').textContent = role.charAt(0).toUpperCase() + role.slice(1);
        document.getElementById('modal-new-name').value = gameState.players[role].name;
        document.getElementById('modal-new-status').value = gameState.players[role].status;
        document.getElementById('edit-profile-modal').classList.remove('hidden');
    } else if (type === 'options') {
        // Highlight current layout button
        document.getElementById('layout-modern-btn').classList.toggle('btn-primary', currentLayout === 'modern');
        document.getElementById('layout-modern-btn').classList.toggle('btn-secondary', currentLayout !== 'modern');
        document.getElementById('layout-classic-btn').classList.toggle('btn-primary', currentLayout === 'classic');
        document.getElementById('layout-classic-btn').classList.toggle('btn-secondary', currentLayout !== 'classic');
        document.getElementById('options-modal').classList.remove('hidden');
    }
}

window.hideModal = function(type) {
    if (type === 'generic') {
        document.getElementById('generic-modal').classList.add('hidden');
    } else if (type === 'edit-profile') {
        document.getElementById('edit-profile-modal').classList.add('hidden');
    } else if (type === 'options') {
        document.getElementById('options-modal').classList.add('hidden');
    }
}

window.alert = function(message) {
    document.getElementById('modal-title').textContent = "Notice";
    document.getElementById('modal-message').textContent = message;
    showModal('generic');
}

/**
 * Generates a random 6-digit alphanumeric code (letters and numbers).
 * @returns {string} The generated code.
 */
function generateRandomLedgerId() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Checks Firestore to see if a ledger with the given ID already exists.
 * @param {string} id The proposed ledger ID.
 * @returns {Promise<boolean>} True if the document exists, false otherwise.
 */
async function checkLedgerIdExists(id) {
    if (!db) {
        console.error("Firestore not initialized.");
        return true; // Assume collision if DB fails to prevent data loss
    }
    try {
        const docRef = doc(db, `artifacts/${appId}/public/data/ledgers`, id);
        const docSnap = await getDoc(docRef);
        return docSnap.exists();
    } catch (e) {
        console.error("Error checking ledger ID existence:", e);
        // This is a critical check, if it fails, better to halt hosting.
        throw new Error("Failed to check ledger availability. Please try again.");
    }
}

/**
 * Handles the logic for a user hosting a new ledger.
 * @param {string} type 'custom' or 'random'
 */
window.hostNewLedger = async function(type) {
    document.getElementById('host-error').classList.add('hidden');
    let newLedgerId;

    if (type === 'custom') {
        newLedgerId = document.getElementById('new-ledger-id').value.trim();
        if (newLedgerId.length < 3) {
            document.getElementById('host-error').textContent = "Custom code must be at least 3 characters long.";
            document.getElementById('host-error').classList.remove('hidden');
            return;
        }
    } else {
        // Generate a random ID and check for collision
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            newLedgerId = generateRandomLedgerId();
            if (!(await checkLedgerIdExists(newLedgerId))) {
                isUnique = true;
            }
            attempts++;
        }
        if (!isUnique) {
            document.getElementById('host-error').textContent = "Failed to generate a unique random code after several attempts. Try a custom code.";
            document.getElementById('host-error').classList.remove('hidden');
            return;
        }
    }

    try {
        // Final check for the determined ID
        if (await checkLedgerIdExists(newLedgerId)) {
            document.getElementById('host-error').textContent = `Ledger ID '${newLedgerId}' is already in use. Please choose another.`;
            document.getElementById('host-error').classList.remove('hidden');
            return;
        }

        // Create the new ledger document with initial state
        const docRef = doc(db, `artifacts/${appId}/public/data/ledgers`, newLedgerId);
        
        // Define the initial state for a new ledger
        const initialLedgerState = {
            ...gameState, // Uses the base template
            // Update initial player IDs to the current user's ID
            players: {
                keeper: { ...gameState.players.keeper, id: userId, name: 'The Keeper' },
                nightingale: { ...gameState.players.nightingale, id: '---', name: 'User 2' }
            },
            ledgerId: newLedgerId,
            timestamp: Date.now()
        };

        await setDoc(docRef, initialLedgerState);
        console.log(`New Ledger created with ID: ${newLedgerId}`);
        
        // Success: store ID and connect
        ledgerId = newLedgerId;
        localStorage.setItem('ledgerId', ledgerId);
        window.connectToLedger(ledgerId);

    } catch (e) {
        console.error("Error hosting new ledger:", e);
        document.getElementById('host-error').textContent = `Error creating ledger: ${e.message}`;
        document.getElementById('host-error').classList.remove('hidden');
    }
}

/**
 * Handles the logic for a user joining an existing ledger.
 */
window.joinExistingLedger = async function() {
    document.getElementById('join-error').classList.add('hidden');
    const joinId = document.getElementById('join-ledger-id').value.trim();

    if (joinId.length === 0) {
        document.getElementById('join-error').textContent = "Please enter a ledger code.";
        document.getElementById('join-error').classList.remove('hidden');
        return;
    }

    try {
        const exists = await checkLedgerIdExists(joinId);
        if (!exists) {
            document.getElementById('join-error').textContent = `Ledger ID '${joinId}' not found. Check the code and try again.`;
            document.getElementById('join-error').classList.remove('hidden');
            return;
        }

        // Success: store ID and connect
        ledgerId = joinId;
        localStorage.setItem('ledgerId', ledgerId);
        window.connectToLedger(ledgerId);

    } catch (e) {
        console.error("Error joining ledger:", e);
        document.getElementById('join-error').textContent = `Error joining ledger: ${e.message}`;
        document.getElementById('join-error').classList.remove('hidden');
    }
}

/**
 * Connects to the specified ledger ID (starts the onSnapshot listener).
 * @param {string} id The Ledger ID (room code).
 */
window.connectToLedger = function(id) {
    document.getElementById('join-host-modal').classList.add('hidden');
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');

    GAME_STATE_PATH = `artifacts/${appId}/public/data/ledgers/${id}`;
    document.getElementById('current-ledger-id').textContent = id;
    
    // Set initial layout based on preference
    window.toggleLayout(currentLayout, true);

    const docRef = doc(db, GAME_STATE_PATH);

    // Set up real-time listener
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            gameState = docSnap.data();
            console.log("Current Ledger state:", gameState);

            // Determine user's role (keeper, nightingale, or observer)
            const keeper = gameState.players.keeper.id;
            const nightingale = gameState.players.nightingale.id;

            if (userId === keeper) {
                currentRole = 'keeper';
                // If this is the Keeper, update the Nightingale ID if they join for the first time
                if (nightingale === '---') {
                    // This is handled by the joinExistingLedger function when Nightingale joins
                }
            } else if (userId === nightingale) {
                currentRole = 'nightingale';
            } else if (nightingale === '---') {
                // Check if user is trying to connect as Nightingale for the first time
                console.log("This user is not the Keeper. Checking if they can claim Nightingale role.");
                // If they have a ledger ID, they should have gone through the join flow.
                // We update the Nightingale ID here if the current user joins as Nightingale
                updateNightigaleIdIfNecessary(id);
            } else {
                currentRole = 'observer';
                window.alert("You are viewing this ledger as an observer. You cannot perform actions.");
            }
            
            // Render the data
            window.renderState();
        } else {
            // Ledger document was deleted or invalid ID
            console.error("Ledger document does not exist!");
            localStorage.removeItem('ledgerId');
            window.alert("The ledger was closed or the code is invalid. Please host or join a new one.");
            // Reset to the Host/Join screen
            document.getElementById('app-container').classList.add('hidden');
            document.getElementById('join-host-modal').classList.remove('hidden');
        }
    }, (error) => {
        console.error("Error listening to ledger state:", error);
        window.alert(`Connection Error: ${error.message}`);
    });
}

/**
 * A helper to update the Nightingale ID on first join if necessary.
 * This handles the case where the Nightingale joins and their ID is still '---'.
 */
async function updateNightigaleIdIfNecessary(ledgerID) {
    if (gameState.players.nightingale.id === '---') {
        const docRef = doc(db, `artifacts/${appId}/public/data/ledgers`, ledgerID);
        try {
             // Use transaction to ensure atomic update
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                if (docSnap.exists() && docSnap.data().players.nightingale.id === '---') {
                    // Claim the role
                    const newPlayers = { ...docSnap.data().players };
                    newPlayers.nightingale.id = userId;
                    newPlayers.nightingale.name = 'The Nightingale';

                    transaction.update(docRef, { 
                        'players.nightingale.id': userId,
                        'players.nightingale.name': 'The Nightingale'
                    });
                    console.log("Nightingale role claimed by current user.");
                    currentRole = 'nightingale'; // Update local role
                }
            });
        } catch (e) {
            console.error("Transaction failed to claim Nightingale role:", e);
        }
    }
}


/**
 * Toggles the main application layout between 'modern' (columns) and 'classic' (tabs).
 * @param {string} layout 'modern' or 'classic'.
 * @param {boolean} [initial=false] Whether this is the initial load.
 */
window.toggleLayout = function(layout, initial = false) {
    if (!['modern', 'classic'].includes(layout)) return;

    currentLayout = layout;
    localStorage.setItem('appLayout', layout);

    const modern = document.getElementById('main-modern-columns');
    const classic = document.getElementById('main-classic-tabs');

    if (layout === 'modern') {
        modern.classList.remove('hidden');
        classic.classList.add('hidden');
        // Restore active tab to habits if we're moving from classic to modern
        window.showTab('modern', 'habits');
    } else {
        modern.classList.add('hidden');
        classic.classList.remove('hidden');
        // Restore active tab to habits if we're moving from modern to classic
        window.showTab('classic', 'habits');
    }
    
    // Update button visual state if not initial
    if (!initial) {
        document.getElementById('layout-modern-btn').classList.toggle('btn-primary', layout === 'modern');
        document.getElementById('layout-modern-btn').classList.toggle('btn-secondary', layout !== 'modern');
        document.getElementById('layout-classic-btn').classList.toggle('btn-primary', layout === 'classic');
        document.getElementById('layout-classic-btn').classList.toggle('btn-secondary', layout !== 'classic');
    }
    
    // Ensure data is re-rendered to the appropriate container structure
    window.renderState();
};


/**
 * Toggles which sub-panel is visible in the main content area (Habits, Rewards, Punishments).
 * @param {string} layout 'modern' or 'classic'.
 * @param {string} tab The tab to show ('habits', 'rewards', 'punishments').
 */
window.showTab = function(layout, tab) {
    const tabs = ['habits', 'rewards', 'punishments'];

    // 1. Update Buttons
    tabs.forEach(t => {
        const button = document.getElementById(`tab-${layout}-${t}`);
        if (button) {
            button.classList.toggle('active', t === tab);
            button.classList.toggle('border-b', t !== tab);
            button.classList.toggle('border-b-4', t === tab);
            button.classList.toggle('border-transparent', t !== tab);
            button.classList.toggle('border-[#ce7e95]', t === tab);
        }
    });

    // 2. Update Panels
    tabs.forEach(t => {
        const panel = document.getElementById(`panel-${layout}-${t}`);
        if (panel) {
            panel.classList.toggle('hidden', t !== tab);
        }
    });
};

// Since native window.alert is forbidden, we map it to our custom modal
window.alert = function(message) {
    document.getElementById('modal-title').textContent = "Notice";
    document.getElementById('modal-message').textContent = message;
    showModal('generic');
}

// --- Ledger Interaction Functions ---

/**
 * Updates a simple field in the player object (Name or Status).
 */
window.updateProfile = async function() {
    if (!currentRole || currentRole === 'observer') {
        window.alert("You must be the Keeper or Nightingale to update a profile.");
        return;
    }
    const newName = document.getElementById('modal-new-name').value.trim();
    const newStatus = document.getElementById('modal-new-status').value;

    if (!newName) {
        window.alert("Name cannot be empty.");
        return;
    }

    try {
        const docRef = doc(db, GAME_STATE_PATH);
        await updateDoc(docRef, {
            [`players.${currentRole}.name`]: newName,
            [`players.${currentRole}.status`]: newStatus
        });
        window.hideModal('edit-profile');
    } catch (e) {
        console.error("Error updating profile:", e);
        window.alert("Failed to update profile. Please try again.");
    }
}

/**
 * Toggles the visibility of the Habit creation form.
 */
window.toggleHabitForm = function() {
    const form = document.getElementById('habit-form');
    const icon = document.getElementById('habit-form-toggle-icon');
    form.classList.toggle('hidden');
    icon.classList.toggle('fa-plus-circle', form.classList.contains('hidden'));
    icon.classList.toggle('fa-minus-circle', !form.classList.contains('hidden'));
}

/**
 * Toggles the visibility of the Reward creation form.
 */
window.toggleRewardForm = function() {
    const form = document.getElementById('reward-form');
    const icon = document.getElementById('reward-form-toggle-icon');
    form.classList.toggle('hidden');
    icon.classList.toggle('fa-plus-circle', form.classList.contains('hidden'));
    icon.classList.toggle('fa-minus-circle', !form.classList.contains('hidden'));
}

/**
 * Toggles the visibility of the Punishment creation form.
 */
window.togglePunishmentForm = function() {
    const form = document.getElementById('punishment-form');
    const icon = document.getElementById('punishment-form-toggle-icon');
    form.classList.toggle('hidden');
    icon.classList.toggle('fa-plus-circle', form.classList.contains('hidden'));
    icon.classList.toggle('fa-minus-circle', !form.classList.contains('hidden'));
}

/**
 * Adds a new habit to the ledger.
 */
window.addHabit = async function() {
    if (currentRole !== 'keeper') {
        window.alert("Only the Keeper can define new habits.");
        return;
    }
    const desc = document.getElementById('new-habit-desc').value.trim();
    const points = parseInt(document.getElementById('new-habit-points').value);
    const times = parseInt(document.getElementById('new-habit-times').value);
    const assignee = document.getElementById('new-habit-assignee').value;

    if (!desc || isNaN(points) || points <= 0 || isNaN(times) || times <= 0) {
        window.alert("All habit fields must be valid and positive.");
        return;
    }

    const newHabit = {
        id: crypto.randomUUID(),
        desc: desc,
        points: points,
        timesPerWeek: times,
        assignee: assignee,
        completedCount: 0,
        createdAt: Date.now()
    };
    
    try {
        const docRef = doc(db, GAME_STATE_PATH);
        const newHabits = [...gameState.habits, newHabit];
        await updateDoc(docRef, { habits: newHabits });
        window.toggleHabitForm();
        document.getElementById('new-habit-desc').value = '';
    } catch (e) {
        console.error("Error adding habit:", e);
        window.alert("Failed to add habit.");
    }
};

/**
 * Marks a habit as completed and updates the score.
 * @param {string} habitId The ID of the habit completed.
 */
window.completeHabit = async function(habitId) {
    if (currentRole === 'observer') {
        window.alert("You cannot perform actions as an observer.");
        return;
    }
    try {
        const docRef = doc(db, GAME_STATE_PATH);
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists()) {
                throw "Document does not exist!";
            }
            
            const currentData = docSnap.data();
            const habitIndex = currentData.habits.findIndex(h => h.id === habitId);
            if (habitIndex === -1) {
                throw "Habit not found.";
            }
            
            const habit = currentData.habits[habitIndex];
            const targetRole = habit.assignee;
            
            // Safety check: ensure only the assigned player can complete it
            if (currentRole !== targetRole && currentRole !== 'keeper') {
                 // Keeper can sometimes mark completion for Nightingale
                 if (currentRole === 'nightingale' && targetRole === 'keeper') {
                    throw "You cannot complete the Keeper's habits.";
                 } else if (currentRole === 'keeper' && targetRole === 'nightingale') {
                    // Keeper can mark Nightingale's habit completed
                 } else {
                    throw `Only the ${targetRole.charAt(0).toUpperCase() + targetRole.slice(1)} can complete this habit.`;
                 }
            }


            // Update the state
            const newHabits = [...currentData.habits];
            newHabits[habitIndex].completedCount = (newHabits[habitIndex].completedCount || 0) + 1;
            
            const newScores = { ...currentData.scores };
            newScores[targetRole] = (newScores[targetRole] || 0) + habit.points;

            const newHistory = [...currentData.history, {
                type: 'completion',
                role: targetRole,
                points: habit.points,
                desc: `Completed habit: ${habit.desc}`,
                timestamp: Date.now()
            }];
            
            transaction.update(docRef, {
                habits: newHabits,
                scores: newScores,
                history: newHistory
            });
        });
    } catch (e) {
        console.error("Transaction failed to complete habit:", e);
        window.alert(typeof e === 'string' ? e : "Failed to complete habit due to a transaction error.");
    }
};


/**
 * Adds a new reward to the ledger.
 */
window.addReward = async function() {
    if (currentRole !== 'keeper') {
        window.alert("Only the Keeper can define new rewards.");
        return;
    }
    const title = document.getElementById('new-reward-title').value.trim();
    const cost = parseInt(document.getElementById('new-reward-cost').value);
    const desc = document.getElementById('new-reward-desc').value.trim();
    const assignee = document.getElementById('new-reward-assignee').value;

    if (!title || !desc || isNaN(cost) || cost <= 0) {
        window.alert("All reward fields must be valid and positive.");
        return;
    }

    const newReward = {
        id: crypto.randomUUID(),
        title: title,
        cost: cost,
        desc: desc,
        assignee: assignee, // 'keeper', 'nightingale', or 'both'
        createdAt: Date.now()
    };
    
    try {
        const docRef = doc(db, GAME_STATE_PATH);
        const newRewards = [...gameState.rewards, newReward];
        await updateDoc(docRef, { rewards: newRewards });
        window.toggleRewardForm();
        document.getElementById('new-reward-title').value = '';
        document.getElementById('new-reward-desc').value = '';
    } catch (e) {
        console.error("Error adding reward:", e);
        window.alert("Failed to add reward.");
    }
};

/**
 * Claims a reward and deducts the cost from the player's score.
 * @param {string} rewardId The ID of the reward claimed.
 */
window.claimReward = async function(rewardId) {
    if (currentRole === 'observer') {
        window.alert("You cannot perform actions as an observer.");
        return;
    }
    try {
        const docRef = doc(db, GAME_STATE_PATH);
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(docRef);
            if (!docSnap.exists()) {
                throw "Document does not exist!";
            }

            const currentData = docSnap.data();
            const rewardIndex = currentData.rewards.findIndex(r => r.id === rewardId);
            if (rewardIndex === -1) {
                throw "Reward not found.";
            }

            const reward = currentData.rewards[rewardIndex];
            const playerRole = currentRole;
            
            // Check assignment
            if (reward.assignee !== 'both' && reward.assignee !== playerRole) {
                throw `This reward is only available to the ${reward.assignee.charAt(0).toUpperCase() + reward.assignee.slice(1)}.`;
            }

            // Check score
            if (currentData.scores[playerRole] < reward.cost) {
                throw `Insufficient points. You need ${reward.cost}, but only have ${currentData.scores[playerRole]}.`;
            }

            // Update the state
            const newScores = { ...currentData.scores };
            newScores[playerRole] -= reward.cost;

            const newHistory = [...currentData.history, {
                type: 'reward_claim',
                role: playerRole,
                cost: reward.cost,
                desc: `Claimed reward: ${reward.title}`,
                timestamp: Date.now()
            }];
            
            // Note: Rewards are not removed from the list after claiming
            transaction.update(docRef, {
                scores: newScores,
                history: newHistory
            });
        });
    } catch (e) {
        console.error("Transaction failed to claim reward:", e);
        window.alert(typeof e === 'string' ? e : "Failed to claim reward due to a transaction error.");
    }
};


/**
 * Adds a new punishment to the ledger.
 */
window.addPunishment = async function() {
    if (currentRole !== 'keeper') {
        window.alert("Only the Keeper can define new punishments.");
        return;
    }
    const title = document.getElementById('new-punishment-title').value.trim();
    const desc = document.getElementById('new-punishment-desc').value.trim();

    if (!title || !desc) {
        window.alert("Title and description must not be empty.");
        return;
    }

    const newPunishment = {
        id: crypto.randomUUID(),
        title: title,
        desc: desc,
        createdAt: Date.now()
    };
    
    try {
        const docRef = doc(db, GAME_STATE_PATH);
        const newPunishments = [...gameState.punishments, newPunishment];
        await updateDoc(docRef, { punishments: newPunishments });
        window.togglePunishmentForm();
        document.getElementById('new-punishment-title').value = '';
        document.getElementById('new-punishment-desc').value = '';
    } catch (e) {
        console.error("Error adding punishment:", e);
        window.alert("Failed to add punishment.");
    }
};

/**
 * Assigns a punishment to a player (deducts points or marks a negative event).
 * This function currently only logs the event, as no points are tied to punishments.
 * @param {string} punishmentId The ID of the punishment assigned.
 * @param {string} targetRole The role to assign the punishment to ('keeper' or 'nightingale').
 */
window.assignPunishment = async function(punishmentId, targetRole) {
    // Only the 'other' player or the Keeper can assign punishment
    if (currentRole === 'observer' || currentRole === targetRole) {
        window.alert("You cannot assign a punishment to yourself or as an observer.");
        return;
    }
    
    try {
        const punishment = gameState.punishments.find(p => p.id === punishmentId);
        if (!punishment) {
            window.alert("Punishment not found.");
            return;
        }

        const newHistory = [...gameState.history, {
            type: 'punishment_assign',
            role: targetRole,
            desc: `Assigned punishment to ${gameState.players[targetRole].name}: ${punishment.title}`,
            details: punishment.desc,
            timestamp: Date.now()
        }];

        const docRef = doc(db, GAME_STATE_PATH);
        await updateDoc(docRef, { history: newHistory });
        window.alert(`Punishment '${punishment.title}' assigned to ${gameState.players[targetRole].name}. It is now logged.`);
    } catch (e) {
        console.error("Error assigning punishment:", e);
        window.alert("Failed to assign punishment.");
    }
};

/**
 * Generates an example habit, reward, or punishment into the form fields.
 */
window.generateExample = function(type) {
    if (typeof EXAMPLE_DATABASE === 'undefined' || !EXAMPLE_DATABASE[type + 's']) {
        window.alert("Example data is not loaded correctly.");
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
        // Check if form is hidden, show it
        if (document.getElementById('habit-form').classList.contains('hidden')) { window.toggleHabitForm(); }
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        // Check if form is hidden, show it
        if (document.getElementById('reward-form').classList.contains('hidden')) { window.toggleRewardForm(); }
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        // Check if form is hidden, show it
        if (document.getElementById('punishment-form').classList.contains('hidden')) { window.togglePunishmentForm(); }
    }
}


// --- Rendering Functions ---

/**
 * Renders the entire application state to the DOM.
 */
window.renderState = function() {
    // 1. Update Layout Containers (if in classic view, move forms to be re-rendered)
    if (currentLayout === 'classic') {
        // Move the forms/lists for proper display in the classic tab panels
        document.getElementById('habits-container-classic').appendChild(document.getElementById('habit-form').parentElement);
        document.getElementById('habits-container-classic').appendChild(document.getElementById('habits-list'));

        document.getElementById('rewards-container-classic').appendChild(document.getElementById('reward-form').parentElement);
        document.getElementById('rewards-container-classic').appendChild(document.getElementById('rewards-list'));

        document.getElementById('punishments-container-classic').appendChild(document.getElementById('punishment-form').parentElement);
        document.getElementById('punishments-container-classic').appendChild(document.getElementById('punishments-list'));

    } else {
        // Move them back to the modern view containers
        document.getElementById('panel-modern-habits').insertBefore(document.getElementById('habit-form').parentElement, document.getElementById('habits-list'));
        document.getElementById('panel-modern-habits').appendChild(document.getElementById('habits-list'));

        document.getElementById('panel-modern-rewards').insertBefore(document.getElementById('reward-form').parentElement, document.getElementById('rewards-list'));
        document.getElementById('panel-modern-rewards').appendChild(document.getElementById('rewards-list'));
        
        document.getElementById('panel-modern-punishments').insertBefore(document.getElementById('punishment-form').parentElement, document.getElementById('punishments-list'));
        document.getElementById('panel-modern-punishments').appendChild(document.getElementById('punishments-list'));
    }

    // 2. Scores and Player Info
    const roles = ['keeper', 'nightingale'];
    roles.forEach(role => {
        const player = gameState.players[role];
        const score = gameState.scores[role];
        
        // Modern Columns Layout Update
        document.getElementById(`${role}-name`).textContent = player.name;
        document.getElementById(`${role}-id`).textContent = player.id;
        document.getElementById(`${role}-score`).textContent = score;
        document.getElementById(`${role}-status`).textContent = `Status: ${player.status}`;
        document.getElementById(`${role}-status`).classList.toggle('text-green-400', player.status === 'Compliant');
        document.getElementById(`${role}-status`).classList.toggle('text-red-400', player.status === 'In Violation');

        // Classic Tabs Layout Update (for redundancy)
        if (currentLayout === 'classic') {
            document.getElementById(`${role}-name-classic`).textContent = player.name;
            document.getElementById(`${role}-id-classic`).textContent = player.id;
            document.getElementById(`${role}-score-classic`).textContent = score;
            document.getElementById(`${role}-status-classic`).textContent = `Status: ${player.status}`;
            document.getElementById(`${role}-status-classic`).classList.toggle('text-green-400', player.status === 'Compliant');
            document.getElementById(`${role}-status-classic`).classList.toggle('text-red-400', player.status === 'In Violation');
        }

        // Highlight the current user's card
        const cardModern = document.getElementById(`${role}-card`);
        if (cardModern) {
            cardModern.classList.toggle('ring-4', player.id === userId);
            cardModern.classList.toggle('ring-[#ce7e95]', player.id === userId);
        }
    });

    // 3. Habits List
    const habitsList = document.getElementById('habits-list');
    habitsList.innerHTML = '';
    
    if (gameState.habits.length === 0) {
        habitsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic text-glow">No habits defined yet.</p>';
    } else {
        gameState.habits.forEach(habit => {
            const assigneeName = gameState.players[habit.assignee]?.name || 'N/A';
            const html = `
                <div class="card p-4 rounded-lg flex justify-between items-center goth-panel">
                    <div>
                        <p class="font-semibold text-lg text-glow">${habit.desc}</p>
                        <p class="text-sm text-gray-400">
                            ${habit.points} Points | ${habit.timesPerWeek} time(s)/week | Assigned to: <span class="text-[#ce7e95]">${assigneeName}</span>
                        </p>
                        <p class="text-xs text-green-300">Completed: ${habit.completedCount}/${habit.timesPerWeek}</p>
                    </div>
                    <button onclick="window.completeHabit('${habit.id}')" class="btn-action">
                        <i class="fas fa-check"></i>
                    </button>
                </div>
            `;
            habitsList.insertAdjacentHTML('beforeend', html);
        });
    }

    // 4. Rewards List
    const rewardsList = document.getElementById('rewards-list');
    rewardsList.innerHTML = '';
    
    if (gameState.rewards.length === 0) {
        rewardsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic text-glow">No rewards defined yet.</p>';
    } else {
        gameState.rewards.forEach(reward => {
            const assignText = reward.assignee === 'both' ? 'Both' : (gameState.players[reward.assignee]?.name || 'N/A');
            const canClaim = reward.cost <= gameState.scores[currentRole] && (reward.assignee === 'both' || reward.assignee === currentRole);

            const html = `
                <div class="card p-4 rounded-lg goth-panel">
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-bold text-xl text-ce7e95">${reward.title}</h4>
                        <p class="font-bold text-2xl text-green-400">
                            <i class="fas fa-gem"></i> ${reward.cost}
                        </p>
                    </div>
                    <p class="text-sm text-gray-300 mb-3">${reward.desc}</p>
                    <div class="flex justify-between items-center text-xs text-gray-500">
                        <p>Available to: ${assignText}</p>
                        <button 
                            onclick="window.claimReward('${reward.id}')" 
                            class="rounded-full px-4 py-1 font-semibold transition-all duration-300 
                            ${canClaim ? 'btn-primary' : 'bg-gray-500 text-gray-200 cursor-not-allowed'}"
                            ${canClaim ? '' : 'disabled'}
                        >
                            Claim
                        </button>
                    </div>
                </div>
            `;
            rewardsList.insertAdjacentHTML('beforeend', html);
        });
    }

    // 5. Punishments List
    const punishmentsList = document.getElementById('punishments-list');
    punishmentsList.innerHTML = '';
    
    if (gameState.punishments.length === 0) {
        punishmentsList.innerHTML = '<p class="text-center py-4 text-gray-500 italic text-glow">No punishments defined yet.</p>';
    } else {
        gameState.punishments.forEach(punishment => {
            const isKeeper = currentRole === 'keeper';
            const targetRole = isKeeper ? 'nightingale' : 'keeper';
            const targetName = gameState.players[targetRole].name;
            const canAssign = currentRole !== 'observer' && currentRole !== targetRole;

            const html = `
                <div class="card p-4 rounded-lg goth-panel">
                    <h4 class="font-bold text-xl text-red-400 mb-2">${punishment.title}</h4>
                    <p class="text-sm text-gray-300 mb-3">${punishment.desc}</p>
                    <div class="text-xs text-gray-500 text-right">
                        <button 
                            onclick="window.assignPunishment('${punishment.id}', '${targetRole}')" 
                            class="rounded-full px-4 py-1 font-semibold transition-all duration-300 
                            ${canAssign ? 'bg-red-700 text-white hover:bg-red-600' : 'bg-gray-500 text-gray-200 cursor-not-allowed'}"
                            ${canAssign ? '' : 'disabled'}
                        >
                            Assign to ${targetName}
                        </button>
                    </div>
                </div>
            `;
            punishmentsList.insertAdjacentHTML('beforeend', html);
        });
    }

    // 6. History Log
    const historyLog = document.getElementById('history-log');
    historyLog.innerHTML = '';
    
    // Sort history newest first and display top 10
    const sortedHistory = [...gameState.history].sort((a, b) => b.timestamp - a.timestamp).slice(0, 15);

    if (sortedHistory.length === 0) {
        historyLog.innerHTML = '<p class="text-gray-500 italic">No events logged yet...</p>';
    } else {
        sortedHistory.forEach(entry => {
            const date = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let icon = '';
            let color = 'text-gray-400';
            
            if (entry.type === 'completion') {
                icon = '<i class="fas fa-plus text-green-500"></i>';
                color = 'text-green-300';
            } else if (entry.type === 'reward_claim') {
                icon = '<i class="fas fa-minus text-purple-500"></i>';
                color = 'text-purple-300';
            } else if (entry.type === 'punishment_assign') {
                icon = '<i class="fas fa-exclamation-triangle text-red-500"></i>';
                color = 'text-red-300';
            }

            historyLog.insertAdjacentHTML('beforeend', `
                <p class="text-xs ${color} font-playfair text-glow">
                    ${icon} [${date}] ${entry.desc}
                </p>
            `);
        });
    }
};

// --- Initialization ---

/**
 * Main initialization function.
 */
async function initFirebase() {
    console.log(`App ID: ${appId}`);
    document.getElementById('current-app-id').textContent = appId;
    
    if (!firebaseConfig) {
        console.error("Firebase config not available.");
        document.getElementById('auth-error-message').textContent = "Firebase configuration is missing.";
        document.getElementById('auth-error-message').classList.remove('hidden');
        return;
    }

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // 1. Authenticate (use custom token if available, otherwise anonymous)
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // For standard web deployment
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('current-user-id').textContent = userId;

                // 2. Check for existing ledgerId in localStorage
                ledgerId = localStorage.getItem('ledgerId');

                if (ledgerId) {
                    // Automatically reconnect to the existing ledger
                    window.connectToLedger(ledgerId);
                } else {
                    // New user or lost connection, show Host/Join prompt
                    document.getElementById('loading-screen').classList.add('hidden');
                    document.getElementById('join-host-modal').classList.remove('hidden');
                }
            } else {
                // Should not happen with anonymous sign-in, but handle just in case
                console.error("No user signed in after attempt.");
                document.getElementById('auth-error-message').textContent = "Authentication failed.";
                document.getElementById('auth-error-message').classList.remove('hidden');
            }
        });

    } catch (e) {
        console.error("Firebase Initialization Error:", e);
        document.getElementById('auth-error-message').textContent = `Initialization Error: ${e.message}`;
        document.getElementById('auth-error-message').classList.remove('hidden');
    }
}

// Run initialization on load
window.onload = initFirebase;