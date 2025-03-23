// Suppress punycode deprecation warning (already handled via --no-deprecation in Render start command)
process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
        return;
    }
    console.warn(warning);
});

// Import required modules
const punycode = require('punycode/');
const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
const app = express();

// Check for Telegram Bot Token
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is not set.');
    process.exit(1);
}
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Middleware setup for Express
app.use(bodyParser.json());

// Health Check Endpoint
app.get('/', (req, res) => {
    res.status(200).send('Bot is running');
});

// In-memory database (Replace with MongoDB or similar for production to persist data across deploys)
const users = new Map(); // { userId: { username, coins, referrals, joinDate, lastCoinUpdate, referredBy, coinsToday } }

// Register User Endpoint
app.post('/register', (req, res) => {
    const { userId, username } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
    }
    if (!users.has(userId)) {
        users.set(userId, {
            username: username || 'Anonymous',
            coins: 0,
            referrals: 0,
            joinDate: new Date(),
            lastCoinUpdate: new Date(),
            referredBy: null,
            coinsToday: 0
        });
        console.log(`User registered: ${userId} (${username || 'Anonymous'})`);
    }
    res.status(200).json({ success: true });
});

// Update Coins Endpoint (with daily cap of 100 coins)
app.post('/update-coins', (req, res) => {
    const { userId, coins } = req.body;
    if (!userId || coins === undefined) {
        return res.status(400).json({ error: 'Missing userId or coins' });
    }
    if (!users.has(userId)) {
        return res.status(404).json({ error: 'User not found' });
    }
    const user = users.get(userId);
    const now = new Date();
    const lastUpdate = new Date(user.lastCoinUpdate);
    const isSameDay = now.toDateString() === lastUpdate.toDateString();

    // Enforce daily coin cap (100 coins/day)
    let coinsToAdd = coins;
    if (isSameDay) {
        const coinsToday = user.coinsToday || 0;
        const remaining = Math.max(0, 100 - coinsToday);
        coinsToAdd = Math.min(coins, remaining);
        user.coinsToday = (user.coinsToday || 0) + coinsToAdd;
    } else {
        user.coinsToday = coinsToAdd; // Reset for a new day
    }

    if (coinsToAdd <= 0) {
        return res.json({ success: true, coinsAdded: 0 });
    }

    user.coins += coinsToAdd;
    user.lastCoinUpdate = now;
    users.set(userId, user);
    console.log(`Updated coins for user ${userId}: +${coinsToAdd} (total: ${user.coins})`);
    res.status(200).json({ success: true, coinsAdded: coinsToAdd });
});

// Leaderboard Endpoint (top 100 players with 5+ referrals)
app.get('/leaderboard', (req, res) => {
    const leaderboard = Array.from(users.entries())
        .map(([userId, user]) => ({
            userId,
            username: user.username,
            coins: user.coins,
            referrals: user.referrals,
            joinDate: user.joinDate
        }))
        .filter(user => user.referrals >= 5) // Minimum 5 referrals
        .sort((a, b) => {
            if (b.coins !== a.coins) return b.coins - a.coins; // Sort by coins (descending)
            if (b.referrals !== a.referrals) return b.referrals - a.referrals; // Tiebreaker: referrals (descending)
            return a.joinDate - b.joinDate; // Tiebreaker: join date (earlier first)
        })
        .slice(0, 100); // Top 100
    res.json(leaderboard);
});

// Bot Commands
bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || ctx.from.first_name || 'Anonymous';
    const referralId = ctx.startPayload; // The user ID from the referral link (e.g., ?start=<user_id>)

    // Register the user if not already registered
    if (!users.has(userId)) {
        users.set(userId, {
            username,
            coins: 0,
            referrals: 0,
            joinDate: new Date(),
            lastCoinUpdate: new Date(),
            referredBy: null,
            coinsToday: 0
        });
        console.log(`User registered via bot: ${userId} (${username})`);
    }

    // Handle referral if a referral ID is provided
    if (referralId && referralId !== userId && users.has(referralId) && !users.get(userId).referredBy) {
        const referrer = users.get(referralId);
        const referredUser = users.get(userId);

        // Mark the user as referred
        referredUser.referredBy = referralId;
        referredUser.coins += 50; // Bonus for the referred user
        referredUser.coinsToday = (referredUser.coinsToday || 0) + 50;
        referrer.referrals += 1; // Increment referrer's referral count
        referrer.coins += 100; // Bonus for the referrer
        referrer.coinsToday = (referrer.coinsToday || 0) + 100;

        // Update the users map
        users.set(userId, referredUser);
        users.set(referralId, referrer);

        // Notify the referrer
        bot.telegram.sendMessage(referralId, `You referred a new player (${username})! You earned 100 coins.`);
        console.log(`Referral processed: ${userId} referred by ${referralId}`);
    }

    // Send welcome message
    const referralLink = `https://t.me/SurvivalArenaGameBot?start=${userId}`;
    const welcomeMessage = referralId && users.get(userId).referredBy
        ? `Welcome to Space Runner! 🚀\nYou joined via a referral and earned 50 coins!\n\nGame: [Click to Play](https://zippy-torte-7326f1.netlify.app)\nReferral Link: ${referralLink}\n\nRefer friends to earn 100 coins (they get 50 coins)!`
        : `Welcome to Space Runner! 🚀\nPlay the game, earn coins, and win SM tokens!\n\nGame: [Click to Play](https://zippy-torte-7326f1.netlify.app)\nReferral Link: ${referralLink}\n\nRefer friends to earn 100 coins (they get 50 coins)!`;
    ctx.reply(welcomeMessage);
});

// Start Bot with Error Handling
bot.launch()
    .then(() => console.log('Bot started'))
    .catch((err) => {
        console.error('Failed to start bot:', err);
        process.exit(1);
    });

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});