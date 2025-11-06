/**
 * EXAMPLE_DATABASE provides default content for habits, rewards, and punishments.
 * NOTE: The 'type' field in habits is retained from a previous schema but is mapped 
 * to 'p1' (keeper) and 'p2' (nightingale) in script.js for assignment.
 */
const EXAMPLE_DATABASE = {
    habits: [
        { 
            type: 'keeper', // Mapped to P1
            description: "Complete all outstanding paperwork.", 
            points: 25 
        },
        { 
            type: 'nightingale', // Mapped to P2
            description: "Exercise for at least 30 minutes (cardio).", 
            points: 15 
        },
        { 
            type: 'keeper', // Mapped to P1
            description: "Perform the full morning routine (including skincare).", 
            points: 10 
        },
        { 
            type: 'nightingale', // Mapped to P2
            description: "Practice the instrument for one hour.", 
            points: 20 
        },
        { 
            type: 'keeper', // Mapped to P1
            description: "Cook dinner and clean the entire kitchen afterwards.", 
            points: 30 
        },
    ],
    rewards: [
        { 
            title: "Movie Night Choice", 
            cost: 40, 
            description: "Absolute control over the movie choice, even the one the other partner hates." 
        },
        { 
            title: "Morning Sleep-In", 
            cost: 60, 
            description: "The other partner handles all morning chores (coffee, letting out pets, breakfast prep) for one day." 
        },
        { 
            title: "Takeout Night", 
            cost: 100, 
            description: "Order expensive takeout, completely paid for by the shared funds." 
        },
        { 
            title: "Back Massage (30 min)", 
            cost: 50, 
            description: "A full 30-minute, no-complaints, focused back and shoulder massage." 
        },
    ],
    punishments: [
        { 
            title: "The Silent Treatment", 
            description: "Must remain silent for one full hour (except for safety/work emergencies)." 
        },
        { 
            title: "Random Chore Draw", 
            description: "Must blindly draw and immediately complete one chore from the 'Punishment Chore Jar'." 
        },
        { 
            title: "Unwanted Song Loop", 
            description: "Must listen to the other partner's most hated song on repeat for 15 minutes." 
        },
    ]
};