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
let isAuthReady = false; // NEW: Flag to ensure DB is initialized
let GAME_STATE_PATH = null;
const GAME_STATE_COLLECTION = 'ledgers'; // Collection where all ledger data is stored
const GAME_STATE_DOC_ID = 'ledger_data';
const LEDGER_DOC_ID_LENGTH = 6; // Length of the random code/document ID

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
    ledgerCode: null, // The 6-character code
    hostId: null,      // The ID of the user who created the ledger
};

// --- Utility Functions ---

/**
 * Generates a random alphanumeric code of a specified length.
 * @param {number} length
 * @returns {string} The generated code.
 */
function generateLedgerCode(length = LEDGER_DOC_ID_LENGTH) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Returns the collection path for publicly shared ledgers.
 * @returns {string} The full Firestore path.
 */
function getLedgerCollectionPath() {
    // Public data for sharing with other users
    return `/artifacts/${appId}/public/data/${GAME_STATE_COLLECTION}`;
}

/**
 * Updates the UI display of the User ID and App ID in the footer.
 */
function updateDebugInfo() {
    document.getElementById('current-user-id').textContent = userId || 'N/A';
    document.getElementById('current-app-id').textContent = appId || 'N/A';
}

/**
 * Shows a custom modal dialog (instead of alert).
 * @param {string} title - The title of the modal.
 * @param {string} message - The content message.
 */
function showModal(title, message) {
    // Logic to show a custom modal (omitted for brevity, assume it exists)
    console.error(`[MODAL] ${title}: ${message}`);
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modal = document.getElementById('custom-modal');

    if (!modal || !modalTitle || !modalBody) return;

    modalTitle.textContent = title;
    modalBody.textContent = message;
    modal.classList.remove('hidden');

    // Add a temporary overlay click handler to close it
    const closeModal = () => {
        modal.classList.add('hidden');
        modal.removeEventListener('click', closeModal);
    };

    // Assuming the modal has a close button or can be clicked to dismiss
    document.getElementById('modal-close-btn').onclick = closeModal;
}


// --- Firebase Interaction ---

/**
 * Attaches a real-time listener to the current ledger document.
 */
function listenToLedger() {
    if (!db || !gameState.ledgerCode) {
        console.error("Database or Ledger Code not ready for listening.");
        return;
    }

    const ledgerDocRef = doc(db, getLedgerCollectionPath(), gameState.ledgerCode);

    onSnapshot(ledgerDocRef, (docSnap) => {
        if (docSnap.exists()) {
            console.log("Current data:", docSnap.data());
            // Update the global state with the new data
            Object.assign(gameState, docSnap.data());
            // Re-render the UI based on the new gameState
            renderUI();
        } else {
            // Document not found or has been deleted
            console.warn("Ledger document does not exist or has been deleted.");
            showModal("Ledger Lost", "The shared ledger has been disconnected or deleted by the host.");
            gameState.ledgerCode = null;
            renderUI();
        }
    }, (error) => {
        console.error("Error listening to ledger:", error);
        showModal("Connection Error", "Failed to maintain real-time connection to the ledger.");
    });
}

/**
 * Placeholder for the UI rendering logic.
 */
function renderUI() {
    // Hide/show the setup screens vs. the main dashboard
    const setupScreen = document.getElementById('setup-screen');
    const mainScreen = document.getElementById('main-dashboard');

    if (gameState.ledgerCode) {
        setupScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');
        document.getElementById('current-ledger-code').textContent = gameState.ledgerCode;
        // Logic to update scores, habits, rewards, etc. based on gameState
        // ...
    } else {
        setupScreen.classList.remove('hidden');
        mainScreen.classList.add('hidden');
    }

    // Update debug info regardless
    updateDebugInfo();
}

/**
 * Attempts to host a new ledger with a randomly generated code.
 */
window.hostNewLedger = async function() {
    if (!db) {
        showModal("Initialization Error", "Database connection is not yet ready. Please wait a moment and try again.");
        return; // CRITICAL FIX: Ensure DB is ready
    }

    const newCode = generateLedgerCode();
    const ledgerDocRef = doc(db, getLedgerCollectionPath(), newCode);

    // Initial state for the new ledger
    const initialLedgerData = {
        ...gameState, // Keep local habits/rewards if any were set
        ledgerCode: newCode,
        hostId: userId,
        createdAt: new Date().toISOString(),
        isHosted: true,
        // Reset scores for a fresh start on hosting
        scores: { keeper: 0, nightingale: 0 }
    };

    try {
        // Check if the document already exists (highly unlikely with random code, but safe)
        const docSnap = await getDoc(ledgerDocRef);
        if (docSnap.exists()) {
            // If it exists, try again (recursion, but unlikely to happen)
            showModal("Hosting Conflict", "A ledger with this code already exists. Retrying...");
            return hostNewLedger();
        }

        // Set the new document
        await setDoc(ledgerDocRef, initialLedgerData);

        // Success! Update local state and start listening
        gameState.ledgerCode = newCode;
        gameState.hostId = userId;
        console.log(`Hosted new ledger with code: ${newCode}`);
        showModal("Ledger Hosted!", `Your new shared ledger code is: ${newCode}. Share this with your partner!`);
        listenToLedger();
        renderUI();

    } catch (error) {
        console.error("Error hosting new ledger:", error);
        showModal("Hosting Failed", "Could not create the ledger document. Check console for details.");
    }
}

/**
 * Attempts to join an existing ledger using a code.
 */
window.joinLedger = async function() {
    if (!db) {
        showModal("Initialization Error", "Database connection is not yet ready. Please wait a moment and try again.");
        return; // CRITICAL FIX: Ensure DB is ready
    }

    const code = document.getElementById('join-code').value.toUpperCase().trim();

    if (code.length !== LEDGER_DOC_ID_LENGTH) {
        showModal("Invalid Code", `The ledger code must be exactly ${LEDGER_DOC_ID_LENGTH} characters long.`);
        return;
    }

    const ledgerDocRef = doc(db, getLedgerCollectionPath(), code);

    try {
        const docSnap = await getDoc(ledgerDocRef);

        if (docSnap.exists()) {
            // Ledger found! Update local state and start listening
            const remoteData = docSnap.data();
            gameState.ledgerCode = code;
            gameState.hostId = remoteData.hostId;
            // Overwrite local state with remote ledger state
            Object.assign(gameState, remoteData);

            console.log(`Joined ledger with code: ${code}`);
            showModal("Joined Successfully", `Connected to ledger ${code}.`);
            listenToLedger();
            renderUI();

            // Optional: You could update the ledger here to record the new user joined
            // await updateDoc(ledgerDocRef, {
            //     joinedUsers: arrayUnion(userId)
            // });

        } else {
            showModal("Code Not Found", `No active ledger found for code: ${code}. Please verify the code.`);
        }
    } catch (error) {
        console.error("Error joining ledger:", error);
        showModal("Joining Failed", "Could not connect to the ledger. Check console for details.");
    }
}


// --- Core Initialization ---

/**
 * Initializes Firebase, authenticates the user, and sets up the app.
 */
window.initApp = async function() {
    if (!firebaseConfig) {
        showModal("Configuration Error", "Firebase configuration is missing. Cannot start the application.");
        return;
    }

    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        // Enable verbose logging for debugging
        // setLogLevel('debug');

        // Authentication Handler
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
            } else {
                // If sign-in fails or is not complete, try anonymous sign-in
                try {
                    await signInAnonymously(auth);
                } catch (anonError) {
                    console.error("Anonymous sign-in failed:", anonError);
                }
            }

            // Authentication is complete, DB is ready
            isAuthReady = true;
            console.log("Firebase services are ready. User ID:", userId);

            // Re-render the UI once authenticated
            renderUI();
        });

        // Use custom token if provided (for Canvas environment)
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        }

    } catch (error) {
        console.error("Failed to initialize Firebase:", error);
        showModal("Initialization Failure", "The application could not connect to Firebase services.");
    }
};


// --- Event Handlers & Local State Management ---

// ... (Your other functions like toggleHabitForm, addHabit, etc. should go here)
// Example structure:

window.addHabit = function() {
    if (!gameState.ledgerCode) {
        showModal("Not Connected", "Please host or join a ledger before defining habits.");
        return;
    }
    // ... logic to get form data ...
    // ... logic to update the remote document using updateDoc() ...
};

window.addReward = function() {
    if (!gameState.ledgerCode) {
        showModal("Not Connected", "Please host or join a ledger before defining rewards.");
        return;
    }
    // ... logic to get form data ...
    // ... logic to update the remote document using updateDoc() ...
};

// ... (Other UI-related functions)
// ...

// Helper functions for UI toggling (assuming they existed)
window.toggleSetup = function(section) {
    const screens = ['host-ledger', 'join-ledger', 'define-rules'];
    screens.forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(section).classList.remove('hidden');
}

// Placeholder for generating example data (required to be present for other functions)
// Note: This function relies on EXAMPLE_DATABASE being loaded.
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
        document.getElementById('new-habit-assignee').value = example.type;
        window.toggleSetup('define-rules'); // Show rules section
    } else if (type === 'reward') {
        document.getElementById('new-reward-title').value = example.title;
        document.getElementById('new-reward-cost').value = example.cost;
        document.getElementById('new-reward-desc').value = example.description;
        window.toggleSetup('define-rules');
    } else if (type === 'punishment') {
        document.getElementById('new-punishment-title').value = example.title;
        document.getElementById('new-punishment-desc').value = example.description;
        window.toggleSetup('define-rules');
    }
}


// Start the application when the window loads
window.onload = initApp;