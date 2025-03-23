process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
        return;
    }
    console.warn(warning);
});
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

// Middleware
app.use(bodyParser.json());

// Health Check Endpoint
app.get('/', (req, res) => {
    res.status(200).send('Bot is running');
});

// In-memory database (Replace with MongoDB or similar for production)
const users = new Map(); // { userId: { username, coins, referrals, joinDate } }

// Register User
app.post('/register', (req, res) => {
    const { userId, username } = req.body;
    if (!userId) {
        return res.status(400).send('Missing userId');
    }
    if (!users.has(userId)) {
        users.set(userId, {
            username: username || 'Anonymous',
            coins: 0,
            referrals: 0,
            joinDate: new Date()
        });
    }
    res.status(200).send('User registered');
});

// Update Coins
app.post('/update-coins', (req, res) => {
    const { userId, coins } = req.body;
    if (!userId || coins === undefined) {
        return res.status(400).send('Missing userId or coins');
    }
    if (users.has(userId)) {
        const user = users.get(userId);
        user.coins += coins;
        users.set(userId, user);
    }
    res.status(200).send('Coins updated');
});

// Leaderboard
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
            if (b.coins !== a.coins) return b.coins - a.coins; // Sort by coins
            if (b.referrals !== a.referrals) return b.referrals - a.referrals; // Tiebreaker: referrals
            return a.joinDate - b.joinDate; // Tiebreaker: join date
        })
        .slice(0, 100); // Top 100
    res.json(leaderboard);
});

// Bot Commands
bot.start((ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'Anonymous';
    if (!users.has(userId)) {
        users.set(userId, {
            username,
            coins: 0,
            referrals: 0,
            joinDate: new Date()
        });
    }

    // Generate referral link
    const referralLink = `https://t.me/SurvivalArenaGameBot?start=${userId}`;
    ctx.reply(`Welcome to Space Runner! 🚀\nPlay the game, earn coins, and win SM tokens!\n\nGame: [Click to Play](https://zippy-torte-7326f1.netlify.app)\nReferral Link: ${referralLink}\n\nRefer friends to earn 100 coins (they get 50 coins)!`);
});

// Handle Referrals
bot.on('text', (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/start ') && text.length > 7) {
        const referrerId = text.split(' ')[1];
        const userId = ctx.from.id;
        const username = ctx.from.username || 'Anonymous';

        if (referrerId !== userId.toString() && !users.has(userId)) {
            users.set(userId, {
                username,
                coins: 50, // Bonus for new user
                referrals: 0,
                joinDate: new Date()
            });

            if (users.has(referrerId)) {
                const referrer = users.get(referrerId);
                referrer.coins += 100; // Bonus for referrer
                referrer.referrals += 1;
                users.set(referrerId, referrer);
                bot.telegram.sendMessage(referrerId, `You referred a new player (${username})! You earned 100 coins.`);
            }

            ctx.reply(`Welcome to Space Runner! 🚀\nYou joined via a referral and earned 50 coins!\n\nGame: [Click to Play](https://zippy-torte-7326f1.netlify.app)`);
        }
    }
});

// Start Bot
bot.launch();
console.log('Bot started');

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});