const { Bot, InlineKeyboard } = require("grammy");
const { bip39, BigNumber } = require("@okxweb3/crypto-lib");
const { EthWallet } = require("@okxweb3/coin-ethereum");
const fetch = require("node-fetch");
const crypto = require("crypto");

// Validate required environment variables
const REQUIRED_ENV = [
  "TELEGRAM_BOT_TOKEN",
  "OKX_PROJECT_ID",
  "OKX_API_KEY",
  "OKX_API_SECRET_KEY",
  "OKX_API_PASSPHRASE",
  "ENCRYPTION_KEY",
];

for (const env of REQUIRED_ENV) {
  if (!process.env[env]) {
    throw new Error(`Missing ${env} environment variable`);
  }
}

// Initialize bot and wallet
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const wallet = new EthWallet();

// Constants
const API_BASE_URL = "https://www.okx.com";
const CHAIN_ID = "196";

// In-memory state management
const userStates = {};

// Helper function to update user state
function updateUserState(user, state) {
  userStates[user.id] = { ...userStates[user.id], ...state };
}

// Helper function to generate API request URL
function getRequestUrl(path, params = {}) {
  const url = new URL(path, API_BASE_URL);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.append(key, value),
  );
  return url.toString();
}

// Helper function to generate API headers
function getHeaders(method, path, body = "") {
  const timestamp = new Date().toISOString();
  const signString = timestamp + method.toUpperCase() + path + body;
  const signature = crypto
    .createHmac("sha256", process.env.OKX_API_SECRET_KEY)
    .update(signString)
    .digest("base64");

  return {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": process.env.OKX_API_KEY,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": process.env.OKX_API_PASSPHRASE,
    "OK-ACCESS-PROJECT": process.env.OKX_PROJECT_ID,
  };
}

// Helper function to send reply and update message ID
async function sendReply(ctx, text, options = {}) {
  const message = await ctx.reply(text, options);
  updateUserState(ctx.from, { messageId: message.message_id });
  return message;
}

// Create or get existing wallet address
async function getOrCreateAddress(user) {
  if (userStates[user.id]?.address) {
    return userStates[user.id].address;
  }

  const mnemonic = await bip39.generateMnemonic();
  const hdPath = await wallet.getDerivedPath({ index: 0 });
  const privateKey = await wallet.getDerivedPrivateKey({
    mnemonic,
    hdPath,
  });
  const newAddress = await wallet.getNewAddress({ privateKey });

  updateUserState(user, {
    address: newAddress.address,
    privateKey: privateKey,
    publicKey: newAddress.publicKey,
  });

  return newAddress.address;
}

// Start command handler
bot.command("start", async (ctx) => {
  console.log("Processing start command...");
  const { from: user } = ctx;
  const address = await getOrCreateAddress(user);

  const keyboard = new InlineKeyboard()
    .text("Check Balance", "check_balance")
    .row()
    .text("Deposit OKB", "deposit_OKB")
    .row()
    .text("Withdraw OKB", "withdraw_OKB")
    .row()
    .text("Export Key", "export_key")
    .row()
    .text("Pin Message", "pin_message");

  await sendReply(
    ctx,
    `*Welcome to your XLayer Trading Bot!*\nYour XLayer address is ${address}.\nSelect an option below:`,
    { reply_markup: keyboard, parse_mode: "Markdown" },
  );
});

// Balance check handler
async function handleCheckBalance(ctx) {
  console.log("Checking balance...");
  const address = await getOrCreateAddress(ctx.from);

  try {
    const response = await fetch(
      getRequestUrl("/api/v5/wallet/asset/token-balances-by-address"),
      {
        method: "POST",
        headers: getHeaders(
          "POST",
          "/api/v5/wallet/asset/token-balances-by-address",
          JSON.stringify({
            address,
            tokenAddresses: [{ chainIndex: CHAIN_ID, tokenAddress: "" }],
          }),
        ),
        body: JSON.stringify({
          address,
          tokenAddresses: [{ chainIndex: CHAIN_ID, tokenAddress: "" }],
        }),
      },
    );

    const data = await response.json();
    console.log("Balance API Response:", JSON.stringify(data, null, 2));

    if (data.code === "0" && data.data?.[0]?.tokenAssets?.[0]) {
      const {
        balance,
        tokenPrice,
        symbol = "OKB",
      } = data.data[0].tokenAssets[0];
      const formattedBalance = parseFloat(balance).toFixed(8);
      const value = (parseFloat(balance) * parseFloat(tokenPrice)).toFixed(2);

      await sendReply(
        ctx,
        `Your XLayer ${symbol} balance:\n${formattedBalance} ${symbol} (USD ${value})`,
      );
    } else {
      throw new Error(data.msg || "No balance data received");
    }
  } catch (error) {
    console.error("Balance check error:", error);
    await ctx.reply(
      "An error occurred while checking your balance. Please try again later.",
    );
  }
}

// Deposit handler
async function handleDeposit(ctx) {
  console.log("Processing deposit request...");
  const address = await getOrCreateAddress(ctx.from);

  await sendReply(
    ctx,
    "_Note: Make sure to deposit only to this address on the XLayer network!_",
    { parse_mode: "Markdown" },
  );
  await sendReply(ctx, "Please send your OKB to the following address:");
  await sendReply(ctx, `\`${address}\``, { parse_mode: "Markdown" });
}

// Withdrawal flow handlers
async function handleWithdrawalRequest(ctx) {
  console.log("Starting withdrawal flow...");
  updateUserState(ctx.from, { withdrawalRequested: true });
  await sendReply(
    ctx,
    "Please respond with the amount of OKB you want to withdraw.",
    { reply_markup: { force_reply: true } },
  );
}

async function handleWithdrawal(ctx) {
  const userState = userStates[ctx.from.id] || {};
  console.log("Processing withdrawal...");

  if (!userState.withdrawalAmount) {
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        "Invalid withdrawal amount. Please enter a positive number.",
      );
      return;
    }

    updateUserState(ctx.from, { withdrawalAmount: amount });
    await sendReply(
      ctx,
      "Please respond with the XLayer address where you would like to receive the OKB.",
      { reply_markup: { force_reply: true } },
    );
    return;
  }

  const destination = ctx.message.text.toLowerCase();
  if (!destination.startsWith("0x") || destination.length !== 42) {
    await ctx.reply(
      "Invalid destination address format. Please provide a valid Ethereum address.",
    );
    return;
  }

  try {
    await sendReply(ctx, "Initiating withdrawal...");

    const weiAmount = new BigNumber(userState.withdrawalAmount).times(1e18);
    console.log(`Amount in wei: ${weiAmount.toString()}`);

    // Get transaction info
    const signInfoResponse = await fetch(
      getRequestUrl("/api/v5/wallet/pre-transaction/sign-info"),
      {
        method: "POST",
        headers: getHeaders(
          "POST",
          "/api/v5/wallet/pre-transaction/sign-info",
          JSON.stringify({
            chainIndex: CHAIN_ID,
            fromAddr: userState.address,
            toAddr: destination,
            txAmount: weiAmount.toString(),
          }),
        ),
        body: JSON.stringify({
          chainIndex: CHAIN_ID,
          fromAddr: userState.address,
          toAddr: destination,
          txAmount: weiAmount.toString(),
        }),
      },
    );

    const signInfoData = await signInfoResponse.json();
    console.log("Sign info response:", signInfoData);

    if (signInfoData.code !== "0") {
      throw new Error(signInfoData.msg || "Failed to get transaction info");
    }

    const txData = signInfoData.data[0];
    const txParams = {
      to: destination,
      value: weiAmount,
      nonce: parseInt(txData.nonce),
      gasPrice: new BigNumber(txData.gasPrice.normal),
      gasLimit: new BigNumber(txData.gasLimit),
      chainId: parseInt(CHAIN_ID),
    };

    console.log("Transaction params:", txParams);

    const privateKey = userState.privateKey.startsWith("0x")
      ? userState.privateKey
      : "0x" + userState.privateKey;

    const signedTx = await wallet.signTransaction({
      privateKey,
      data: txParams,
    });

    console.log("Transaction signed successfully");

    const broadcastResponse = await fetch(
      getRequestUrl("/api/v5/wallet/pre-transaction/broadcast-transaction"),
      {
        method: "POST",
        headers: getHeaders(
          "POST",
          "/api/v5/wallet/pre-transaction/broadcast-transaction",
          JSON.stringify({
            signedTx,
            chainIndex: CHAIN_ID,
            address: userState.address,
          }),
        ),
        body: JSON.stringify({
          signedTx,
          chainIndex: CHAIN_ID,
          address: userState.address,
        }),
      },
    );

    const broadcastData = await broadcastResponse.json();
    console.log("Broadcast response:", broadcastData);

    if (broadcastData.code === "0") {
      await sendReply(
        ctx,
        `Successfully initiated withdrawal of ${userState.withdrawalAmount} OKB to ${destination}. Transaction ID: ${broadcastData.data[0].orderId}`,
        { parse_mode: "Markdown" },
      );
    } else {
      throw new Error(broadcastData.msg || "Failed to broadcast transaction");
    }
  } catch (error) {
    console.error("Withdrawal error:", error);
    await ctx.reply(
      "An error occurred while initiating the withdrawal. Error: " +
        (error.message || "Unknown error"),
    );
  }
}

// Export private key handler
async function handleExportKey(ctx) {
  console.log("Processing key export request...");
  const userState = userStates[ctx.from.id];

  if (userState?.privateKey) {
    await sendReply(
      ctx,
      "Your private key will be in the next message. Do NOT share it with anyone, and make sure you store it in a safe place.",
    );
    await sendReply(ctx, `\`${userState.privateKey}\``, {
      parse_mode: "Markdown",
    });
  } else {
    await ctx.reply(
      "No wallet found for this user. Please start a new session.",
    );
  }
}

// Pin message handler
async function handlePinMessage(ctx) {
  console.log("Attempting to pin message...");
  try {
    await ctx.api.pinChatMessage(
      ctx.chat.id,
      userStates[ctx.from.id].messageId,
    );
    await ctx.reply("Message pinned successfully!");
  } catch (error) {
    console.error("Pin message error:", error);
    await ctx.reply(
      "Failed to pin the message. Ensure the bot has the proper permissions.",
    );
  }
}

// Register callback handlers
const callbackHandlers = {
  check_balance: handleCheckBalance,
  deposit_OKB: handleDeposit,
  withdraw_OKB: handleWithdrawalRequest,
  export_key: handleExportKey,
  pin_message: handlePinMessage,
};

// Handle callback queries
bot.on("callback_query:data", async (ctx) => {
  const handler = callbackHandlers[ctx.callbackQuery.data];
  if (handler) {
    console.log(`Executing callback handler: ${ctx.callbackQuery.data}`);
    await ctx.answerCallbackQuery();
    await handler(ctx);
  } else {
    console.log(`Unknown callback received: ${ctx.callbackQuery.data}`);
    await ctx.reply("Unknown button clicked!");
  }

  console.log(
    `User interaction - ID: ${ctx.from.id}, Username: ${ctx.from.username}, First Name: ${ctx.from.first_name}`,
  );
});

// Handle text messages for withdrawal flow
bot.on("message:text", async (ctx) => {
  const userState = userStates[ctx.from.id] || {};
  const messageId = ctx.message?.reply_to_message?.message_id;

  if (userState.withdrawalRequested && messageId === userState.messageId) {
    await handleWithdrawal(ctx);
  }
});

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err);
});

// Start the bot
bot.start();
console.log("XLayer Trading bot is running...");

module.exports = bot;
