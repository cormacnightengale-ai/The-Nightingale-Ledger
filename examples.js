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
        { description: "Ensure adequate 7+ hours of uninterrupted sleep (tracked).", points: 20, type: 'keeper' },

        // Domestic & Financial (Low Points)
        { description: "Load/unload the dishwasher immediately after a meal.", points: 5, type: 'nightingale' },
        { description: "Tidy up the main living area for 10 minutes before bed.", points: 5, type: 'keeper' },
        { description: "Track all expenses for the day accurately in the budget app.", points: 10, type: 'nightingale' },
        { description: "Take out all household trash/recycling without prompting.", points: 8, type: 'keeper' },
    ],

    // --- REWARDS (Title, Cost, Description) ---
    rewards: [
        // Physical/Relaxation
        { title: "Partner Massage (15min)", cost: 50, description: "A 15-minute focused back or foot massage from partner." },
        { title: "Sleep In Pass", cost: 75, description: "Exemption from morning chores (coffee, dishes) and guaranteed 1 hour of undisturbed sleep past usual wake time." },
        { title: "One Free Chore Pass", cost: 100, description: "Redeemable to skip one assigned daily/weekly chore, transferred to the partner." },
        
        // Entertainment/Food
        { title: "Themed Movie Night", cost: 60, description: "Partner organizes and prepares snacks for a requested movie or TV show." },
        { title: "Takeout Upgrade", cost: 40, description: "Redeem for the ability to upgrade a planned takeout night to a slightly more expensive/fancier restaurant." },
        { title: "New Book/Game", cost: 75, description: "Partner buys a small, pre-approved item (book, video game, etc.) under $20." },
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