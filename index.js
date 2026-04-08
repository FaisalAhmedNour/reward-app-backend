const express = require('express');
const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const cors = require('cors');
require('dotenv').config();

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Initialize Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// ========================
// BOT COMMANDS
// ========================

// /start command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || 'User';
  const firstName = ctx.from.first_name || 'User';

  // Check if user exists in database
  const userRef = db.collection('users').doc(String(userId));
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    // Create new user
    await userRef.set({
      userId: userId,
      username: username,
      firstName: firstName,
      balance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      adsWatched: 0,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      referredBy: null
    });
  }

  // Send welcome message with Mini App button
  await ctx.reply(
    `👋 Welcome ${firstName}!\n\n` +
    `💰 Watch ads and earn real TON crypto!\n\n` +
    `📺 Watch 3 ads per click\n` +
    `💵 Earn $0.0015 per ad view\n` +
    `💳 Withdraw at $5.00\n\n` +
    `Click the button below to start earning!`,
    {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🚀 Start Earning',
            web_app: { url: process.env.FRONTEND_URL }
          }
        ]]
      }
    }
  );
});

// /balance command
bot.command('balance', async (ctx) => {
  const userId = ctx.from.id;
  const userRef = db.collection('users').doc(String(userId));
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return ctx.reply('Please use /start first!');
  }

  const user = userDoc.data();
  await ctx.reply(
    `💰 Your Balance\n\n` +
    `Current Balance: $${user.balance.toFixed(4)}\n` +
    `Total Earned: $${user.totalEarned.toFixed(4)}\n` +
    `Total Withdrawn: $${user.totalWithdrawn.toFixed(4)}\n` +
    `Ads Watched: ${user.adsWatched}\n\n` +
    `Minimum withdrawal: $${process.env.MIN_WITHDRAWAL}`
  );
});

// ========================
// API ROUTES
// ========================

// Get user data
app.get('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(userDoc.data());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add earnings after ad view
app.post('/api/earn', async (req, res) => {
  try {
    const { userId, adsCount } = req.body;

    // Each ad = $0.0015 user share
    const earningPerAd = 0.0015;
    const totalEarning = earningPerAd * adsCount;

    const userRef = db.collection('users').doc(String(userId));

    await userRef.update({
      balance: admin.firestore.FieldValue.increment(totalEarning),
      totalEarned: admin.firestore.FieldValue.increment(totalEarning),
      adsWatched: admin.firestore.FieldValue.increment(adsCount)
    });

    // Log the transaction
    await db.collection('transactions').add({
      userId: userId,
      type: 'earn',
      amount: totalEarning,
      adsCount: adsCount,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedDoc = await userRef.get();
    res.json({
      success: true,
      earned: totalEarning,
      newBalance: updatedDoc.data().balance
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request withdrawal
app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, walletAddress } = req.body;
    const minWithdrawal = parseFloat(process.env.MIN_WITHDRAWAL);

    const userRef = db.collection('users').doc(String(userId));
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userDoc.data();

    if (user.balance < minWithdrawal) {
      return res.status(400).json({
        error: `Minimum withdrawal is $${minWithdrawal}. Your balance: $${user.balance.toFixed(4)}`
      });
    }

    // Create withdrawal request
    await db.collection('withdrawals').add({
      userId: userId,
      amount: user.balance,
      walletAddress: walletAddress,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Deduct from balance
    await userRef.update({
      totalWithdrawn: admin.firestore.FieldValue.increment(user.balance),
      balance: 0
    });

    res.json({
      success: true,
      message: 'Withdrawal request submitted! Processing within 24 hours.'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// ✅ ADSGRAM REWARD CALLBACK (NEWLY ADDED)
// ========================
app.post('/api/reward', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'No userId' });
    }

    const earningPerAd = 0.0015;

    const userRef = db.collection('users').doc(String(userId));

    await userRef.update({
      balance: admin.firestore.FieldValue.increment(earningPerAd),
      totalEarned: admin.firestore.FieldValue.increment(earningPerAd),
      adsWatched: admin.firestore.FieldValue.increment(1)
    });

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// START SERVER
// ========================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Start bot
bot.launch();
console.log('Bot started!');