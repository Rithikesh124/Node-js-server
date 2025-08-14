const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const axios = require('axios');
const Jimp = require('jimp');
const { createClient } = require('@supabase/supabase-js');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const DEV_USERNAME = "@DEVELOPERSTAKEBOT";
const ADMIN_ACTIVATION_KEY = "SUPER-ADMIN-2024";

const SINGLE_CELL_URL = "https://i.postimg.cc/dtVfWTSd/Screenshot-20250716-163347-Chrome.jpg";
const DIAMOND_IMAGE_URL = "https://i.postimg.cc/TYpt961H/Screenshot-20250713-204556-Lemur-Browser-removebg-preview-removebg-preview.jpg";
const SERVER_SEED_GUIDE_URL = "https://i.postimg.cc/LsMv2gTr/Screenshot-20250716-164325-Chrome.jpg";
const BET_AMOUNT_GUIDE_URL = "https://i.postimg.cc/qvKQPx8s/Screenshot-20250716-164700-Chrome.jpg";

const INITIAL_TIMED_KEYS = [
    { key_name: "ALPHA-1122", duration_days: 30 }, { key_name: "BETA-3344", duration_days: 30 },
    { key_name: "GAMMA-5566", duration_days: 7 }, { key_name: "DELTA-7788", duration_days: 7 },
    { key_name: "EPSILON-9900", duration_days: 1 }, { key_name: "ZETA-2244", duration_days: 1 },
    { key_name: "THETA-6688", duration_days: 365 }, { key_name: "IOTA-1357", duration_days: 365 }
];

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==============================================================================
// 1. Core Logic & Helpers
// ==============================================================================
// ... (provablyFairMines and generatePredictionImage are unchanged from the previous version)

const isUserPremium = async (userId) => {
    const { data: adminData } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
    if (adminData) return true;

    const { data: userData, error: userError } = await supabase.from('users').select('key_name, activated_at').eq('user_id', userId).maybeSingle();
    if (userError || !userData) return false;

    const { data: keyData, error: keyError } = await supabase.from('keys').select('duration_days').eq('key_name', userData.key_name).maybeSingle();
    if (keyError || !keyData) return false;

    const expirationDate = new Date(userData.activated_at).getTime() + keyData.duration_days * 24 * 60 * 60 * 1000;
    return Date.now() < expirationDate;
};

// ==============================================================================
// 2. Serverless Function Handler
// ==============================================================================
module.exports = async (request, response) => {
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY) return response.status(500).send("Configuration error.");

    const bot = new TelegramBot(BOT_TOKEN);
    const { body } = request;
    const chatId = body.message?.chat.id || body.callback_query?.message.chat.id;
    const userId = body.message?.from.id || body.callback_query?.from.id;

    // Initialize data on first ever run
    const { data: keys, error: keyCheckError } = await supabase.from('keys').select('*', { count: 'exact', head: true });
    if (keyCheckError) console.error("Error checking keys:", keyCheckError);
    if (keys?.count === 0) {
        console.log("No existing keys found. Populating with initial default keys.");
        const { error: insertError } = await supabase.from('keys').insert(INITIAL_TIMED_KEYS);
        if (insertError) console.error("Error inserting initial keys:", insertError);
    }
    
    // Simple state machine using Supabase
    const { data: userState, error: stateError } = await supabase.from('user_states').select('state_data').eq('user_id', userId).maybeSingle();
    let state = userState?.state_data || {};

    try {
        if (body.message?.text === '/start') {
            const keyboard = [[{ text: "Click Here To Start 🚀", callback_data: "start_prediction_flow" }]];
            await bot.sendMessage(chatId, "Start STAKE MINES Predictor 💣", { reply_markup: { inline_keyboard: keyboard } });
            state = {}; // Reset state on /start
        
        } else if (body.callback_query) {
            const query = body.callback_query;
            await bot.answerCallbackQuery(query.id);
            const data = query.data;

            if (data === 'start_prediction_flow') {
                const buttons = Array.from({ length: 22 }, (_, i) => [{ text: `${i + 3}`, callback_data: `mine_${i + 3}` }]);
                await bot.editMessageText("Choose Mines Number From 3-24 ⬇️", { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: buttons } });
            
            } else if (data.startsWith('mine_')) {
                state.mine_count = parseInt(data.split('_')[1]);
                state.step = 'awaiting_server_seed';
                await bot.deleteMessage(chatId, query.message.message_id);
                await bot.sendPhoto(chatId, SERVER_SEED_GUIDE_URL, { caption: `Mines set to <b>${state.mine_count}</b>.\n\nPlease enter the <b>Server Seed</b>:`, parse_mode: 'HTML'});
            }
        
        } else if (body.message?.text) {
            const text = body.message.text;

            if (state.step === 'awaiting_server_seed') {
                state.server_seed = text;
                state.client_seed = "0".repeat(64);
                state.step = 'awaiting_bet_amount';
                await bot.deleteMessage(chatId, body.message.message_id - 1);
                await bot.deleteMessage(chatId, body.message.message_id);
                await bot.sendPhoto(chatId, BET_AMOUNT_GUIDE_URL, { caption: `Great! Now enter your <b>Bet Amount</b>:`, parse_mode: 'HTML'});

            } else if (state.step === 'awaiting_bet_amount') {
                state.bet_amount = text;
                await bot.deleteMessage(chatId, body.message.message_id - 1);
                await bot.deleteMessage(chatId, body.message.message_id);
                
                if (await isUserPremium(userId)) {
                    // Prediction logic here...
                    state = {}; // Reset state
                } else {
                    state.step = 'awaiting_activation_key';
                    await bot.sendMessage(chatId, "❗<b>Activation Required</b>...", { parse_mode: 'HTML' });
                }

            } else if (state.step === 'awaiting_activation_key') {
                await bot.deleteMessage(chatId, body.message.message_id - 1);
                await bot.deleteMessage(chatId, body.message.message_id);
                const key = text.trim().toUpperCase();

                if (key === ADMIN_ACTIVATION_KEY) {
                    await supabase.from('admins').upsert({ user_id: userId });
                    // Prediction logic here...
                    state = {};
                } else {
                    const { data: keyData } = await supabase.from('keys').select('key_name').eq('key_name', key).maybeSingle();
                    if (keyData) {
                        await supabase.from('users').upsert({ user_id: userId, key_name: key, activated_at: new Date().toISOString() });
                        // Prediction logic here...
                        state = {};
                    } else {
                        // Invalid key message...
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error processing update:', error);
        state = {}; // Reset state on error
    } finally {
        await supabase.from('user_states').upsert({ user_id: userId, state_data: state });
    }
    
    response.status(200).send("OK");
};            bombs.add(removed);
        }
    }
    return Array.from({ length: 25 }, (_, i) => i).filter(i => !bombs.has(i));
};

const generatePredictionImage = async (safeTiles) => {
    try {
        const [cellBuffer, diamondBuffer] = await Promise.all([
            axios.get(SINGLE_CELL_URL, { responseType: 'arraybuffer' }).then(res => res.data),
            axios.get(DIAMOND_IMAGE_URL, { responseType: 'arraybuffer' }).then(res => res.data)
        ]);

        const cell = await Jimp.read(cellBuffer);
        const diamondOriginal = await Jimp.read(diamondBuffer);

        const GRID_SIZE = 5;
        const { width: cellWidth, height: cellHeight } = cell.bitmap;
        const background = new Jimp(cellWidth * GRID_SIZE, cellHeight * GRID_SIZE);

        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                background.composite(cell, c * cellWidth, r * cellHeight);
            }
        }

        const diamond = diamondOriginal.resize(cellWidth, cellHeight);
        const numToShow = Math.floor(Math.random() * 3) + 4; // 4 to 6
        const tilesToShow = safeTiles.sort(() => 0.5 - Math.random()).slice(0, numToShow);

        for (const index of tilesToShow) {
            const r = Math.floor(index / GRID_SIZE);
            const c = index % GRID_SIZE;
            background.composite(diamond, c * cellWidth, r * cellHeight);
        }
        
        return await background.getBufferAsync(Jimp.MIME_PNG);
    } catch (error) {
        console.error("Image generation failed:", error);
        return null;
    }
};

const isUserPremium = async (userId) => {
    const userActivationInfo = await kv.get('user_activation_info') || {};
    if (!userActivationInfo[userId]) return false;

    const { key, activated_at } = userActivationInfo[userId];
    if (key === ADMIN_ACTIVATION_KEY) return true;

    const allKeys = await kv.get('activation_keys') || {};
    const durationDays = allKeys[key];
    if (!durationDays) return false;
    
    const expirationDate = new Date(activated_at).getTime() + durationDays * 24 * 60 * 60 * 1000;
    return Date.now() < expirationDate;
};


// ==============================================================================
// 2. Serverless Function Handler (The Core of the Vercel Bot)
// ==============================================================================
module.exports = async (request, response) => {
    if (!BOT_TOKEN) return response.status(500).send("Bot token not configured.");

    const bot = new TelegramBot(BOT_TOKEN);
    const { body } = request;
    const chatId = body.message?.chat.id || body.callback_query?.message.chat.id;
    const userId = body.message?.from.id || body.callback_query?.from.id;

    // Initialize data on first ever run
    const keysExist = await kv.exists('activation_keys');
    if (!keysExist) {
        console.log("No existing keys found. Populating with initial default keys.");
        await kv.set('activation_keys', INITIAL_TIMED_KEYS);
    }

    // A simple state machine using Vercel KV
    let userState = await kv.get(`user_state_${userId}`) || {};

    try {
        if (body.message?.text === '/start') {
            const keyboard = [[{ text: "Click Here To Start 🚀", callback_data: "start_prediction_flow" }]];
            await bot.sendMessage(chatId, "Start STAKE MINES Predictor 💣", { reply_markup: { inline_keyboard: keyboard } });
        
        } else if (body.callback_query) {
            const query = body.callback_query;
            const data = query.data;
            await bot.answerCallbackQuery(query.id);

            if (data === 'start_prediction_flow') {
                const buttons = Array.from({ length: 22 }, (_, i) => [{ text: `${i + 3}`, callback_data: `mine_${i + 3}` }]);
                await bot.editMessageText("Choose Mines Number From 3-24 ⬇️", {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: { inline_keyboard: buttons }
                });
                userState = { step: 'awaiting_server_seed' };
            } else if (data.startsWith('mine_')) {
                const mineCount = parseInt(data.split('_')[1]);
                userState.mine_count = mineCount;
                userState.step = 'awaiting_server_seed';
                await bot.deleteMessage(chatId, query.message.message_id);
                await bot.sendPhoto(chatId, SERVER_SEED_GUIDE_URL, { caption: `Mines set to <b>${mineCount}</b>.\n\nPlease enter the <b>Server Seed</b>:`, parse_mode: 'HTML'});
            }
        
        } else if (body.message?.text) {
            const text = body.message.text;

            if (userState.step === 'awaiting_server_seed') {
                userState.server_seed = text;
                userState.client_seed = "0".repeat(64);
                userState.step = 'awaiting_bet_amount';
                await bot.deleteMessage(chatId, body.message.message_id -1);
                await bot.deleteMessage(chatId, body.message.message_id);
                await bot.sendPhoto(chatId, BET_AMOUNT_GUIDE_URL, { caption: `Great! Now enter your <b>Bet Amount</b>:`, parse_mode: 'HTML'});

            } else if (userState.step === 'awaiting_bet_amount') {
                userState.bet_amount = text;
                await bot.deleteMessage(chatId, body.message.message_id -1);
                await bot.deleteMessage(chatId, body.message.message_id);
                
                if (await isUserPremium(userId)) {
                    const loadingMsg = await bot.sendMessage(chatId, "<i>Generating prediction...</i>", { parse_mode: 'HTML' });
                    const safeTiles = provablyFairMines(userState.server_seed, userState.client_seed, Math.floor(Math.random() * 10000), userState.mine_count);
                    const imageBuffer = await generatePredictionImage(safeTiles);
                    await bot.deleteMessage(chatId, loadingMsg.message_id);
                    await bot.sendPhoto(chatId, imageBuffer, { caption: `💎 <b>Prediction Ready!</b> (${userState.mine_count}-mine game).`, parse_mode: 'HTML'});
                    userState = {}; // Reset state
                } else {
                    userState.step = 'awaiting_activation_key';
                    await bot.sendMessage(chatId, "❗<b>Activation Required</b>\nYour key is invalid or has expired. Please enter a key:", { parse_mode: 'HTML' });
                }

            } else if (userState.step === 'awaiting_activation_key') {
                await bot.deleteMessage(chatId, body.message.message_id -1);
                await bot.deleteMessage(chatId, body.message.message_id);
                
                const key = text.trim().toUpperCase();
                const activationKeys = await kv.get('activation_keys') || {};
                let userActivationInfo = await kv.get('user_activation_info') || {};
                let adminUsers = await kv.get('admin_users') || [];
                
                if (key === ADMIN_ACTIVATION_KEY) {
                    if (!adminUsers.includes(userId)) adminUsers.push(userId);
                    userActivationInfo[userId] = { key: ADMIN_ACTIVATION_KEY, activated_at: new Date().toISOString() };
                    await kv.set('admin_users', adminUsers);
                    await kv.set('user_activation_info', userActivationInfo);
                    
                    const loadingMsg = await bot.sendMessage(chatId, "<i>Admin activated. Generating prediction...</i>", { parse_mode: 'HTML' });
                    const safeTiles = provablyFairMines(userState.server_seed, userState.client_seed, Math.floor(Math.random() * 10000), userState.mine_count);
                    const imageBuffer = await generatePredictionImage(safeTiles);
                    await bot.deleteMessage(chatId, loadingMsg.message_id);
                    await bot.sendPhoto(chatId, imageBuffer, { caption: `💎 <b>Prediction Ready!</b> (${userState.mine_count}-mine game).`, parse_mode: 'HTML'});
                    userState = {};

                } else if (activationKeys[key]) {
                    userActivationInfo[userId] = { key: key, activated_at: new Date().toISOString() };
                    await kv.set('user_activation_info', userActivationInfo);
                    
                    const loadingMsg = await bot.sendMessage(chatId, "<i>Generating prediction...</i>", { parse_mode: 'HTML' });
                    const safeTiles = provablyFairMines(userState.server_seed, userState.client_seed, Math.floor(Math.random() * 10000), userState.mine_count);
                    const imageBuffer = await generatePredictionImage(safeTiles);
                    await bot.deleteMessage(chatId, loadingMsg.message_id);
                    await bot.sendPhoto(chatId, imageBuffer, { caption: `💎 <b>Prediction Ready!</b> (${userState.mine_count}-mine game).`, parse_mode: 'HTML'});
                    userState = {};
                } else {
                    const buyButton = [[{ text: "Buy It From Here 🚀", url: `https://t.me/${DEV_USERNAME.slice(1)}` }]];
                    await bot.sendMessage(chatId, "❌ <b>Error!</b> The key is invalid.", { reply_markup: { inline_keyboard: buyButton }, parse_mode: 'HTML' });
                }
            }
        }
    } catch (error) {
        console.error('Error processing update:', error);
        if (chatId) {
            await bot.sendMessage(chatId, "An unexpected error occurred. Please try starting again with /start.");
        }
        userState = {}; // Reset state on error
    } finally {
        await kv.set(`user_state_${userId}`, userState);
    }
    
    response.status(200).send("OK");
};
