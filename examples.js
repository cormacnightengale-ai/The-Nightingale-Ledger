/**
 * EXAMPLE_DATABASE
 * This object holds a large list of pre-defined suggestions for habits, rewards,
 * and punishments to be used by the "Generate Example" buttons in the Nightingale Ledger.
 * This is loaded globally before script.js.
 */
const EXAMPLE_DATABASE = {
    // --- HABITS (Description, Points, Type: 'keeper' or 'nightingale') ---
    habits: [
        // Daily Focus & Productivity (High Points)
        { description: "Complete the designated 'Deep Work' task for the day (min 90 minutes).", points: 30, type: 'keeper' },
        { description: "Review and organize the email inbox, reaching Inbox Zero.", points: 25, type: 'nightingale' },
        { description: "Adhere strictly to the meal plan (no unauthorized snacks/takeout).", points: 35, type: 'keeper' },
        { description: "Dedicate 60 minutes to learning a new professional skill (documented).", points: 40, type: 'nightingale' },
        
        // Health & Wellness (Medium Points)
        { description: "Engage in a moderate-intensity 45-minute exercise session.", points: 15, type: 'keeper' },
        { description: "Prepare lunch for the next day before 9 PM.", points: 10, type: 'nightingale' },
        { description: "Read a physical book for 20 minutes before bedtime.", points: 10, type: 'keeper' },
        { description: "Take all prescribed supplements/medication on time.", points: 5, type: 'nightingale' },
        
        // Domestic & Administrative (Low to Medium Points)
        { description: "Ensure all dishes are washed, dried, and put away after dinner.", points: 15, type: 'keeper' },
        { description: "Tidy up the main living area (5-minute reset).", points: 5, type: 'nightingale' },
        { description: "Balance the checkbook/review banking transactions for the day.", points: 20, type: 'keeper' },
        { description: "Plan the next day's schedule and tasks before retiring.", points: 10, type: 'nightingale' },
        { description: "Clean out the car (dispose of trash, organize items).", points: 20, type: 'keeper' },
        { description: "Engage in 15 minutes of uninterrupted conversation with the partner.", points: 10, type: 'nightingale' },
        
        // Advanced Compliance (High Points)
        { description: "Successfully complete the challenging task assigned on the 'Hard Task' list.", points: 50, type: 'keeper' },
        { description: "Maintain a positive and supportive attitude for the entire day (self-assessed).", points: 25, type: 'nightingale' },
    ],

    // --- REWARDS (Title, Cost, Description) ---
    rewards: [
        // Experience & Indulgence (High Cost)
        { title: "The Partner's Full Attention", cost: 450, description: "A special 3-hour date night planned, paid for, and executed entirely by the partner." },
        { title: "A Day of Quiet Solitude", cost: 600, description: "The partner leaves the home for 6+ hours, allowing the redeemer full and complete privacy and silence." },
        { title: "Banish the Chore", cost: 300, description: "Exemption from the most disliked chore (e.g., taking out trash, deep cleaning bathroom) for one month." },
        
        // Personal Service (Medium Cost)
        { title: "The Loyal Attendant", cost: 180, description: "Partner acts as a personal assistant for one hour, fetching drinks, snacks, and catering to small requests." },
        { title: "Movie Marathon Choice", cost: 120, description: "Unconditional acceptance of a three-movie marathon chosen entirely by the redeemer." },
        { title: "A Special Dessert Creation", cost: 90, description: "Partner bakes or creates a requested dessert from scratch." },
        
        // Small Comforts (Low Cost)
        { title: "First Choice of Dinner", cost: 50, description: "The redeemer gets absolute veto power over what to order or cook for dinner tonight." },
        { title: "Extended Cuddle Time", cost: 35, description: "An extra 30 minutes of dedicated, device-free cuddling/snuggling before sleep." },
        { title: "A New Book/Game", cost: 75, description: "Partner buys a small, pre-approved item (book, video game, etc.) under $20." },
    ],

    // --- PUNISHMENTS (Title, Description) ---
    punishments: [
        // Domestic Tasks
        { title: "The Floor Detail", description: "Must meticulously sweep and mop every hard floor surface in the house." },
        { title: "Refrigerator Purge", description: "Required to empty, clean, and reorganize the entire refrigerator/freezer." },
        { title: "Handwritten Apology", description: "Must write a 250-word, hand-written apology/explanation for the failure of compliance." },
        
        // Self-Discipline
        { title: "Digital Blackout", description: "Must relinquish all non-essential personal electronics (phone/tablet/gaming device) for 12 hours." },
        { title: "Mandatory Silence", description: "Must maintain complete silence (no speaking except for absolute necessity) for 2 hours." },
        { title: "No Sweeteners", description: "Restricted from consuming any added sugars or artificial sweeteners for a period of 48 hours." },
        
        // Collaborative
        { title: "Partner's Errand Run", description: "Must immediately run a spontaneous errand requested by the partner, no matter the distance or time." },
        { title: "The Early Morning Detail", description: "Must perform all the morning chores (coffee, dishes, tidying) alone, starting 30 minutes earlier than usual." },
    ],
};
