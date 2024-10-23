const { Bot, InlineKeyboard } = require("grammy");
const { bip39, BigNumber } = require("@okxweb3/crypto-lib");
const { EthWallet } = require("@okxweb3/coin-ethereum");
const fetch = require("node-fetch");
const crypto = require("crypto");

// Ensure environment variables are set
const requiredEnvVars = [
  "TELEGRAM_BOT_TOKEN",
  "OKX_PROJECT_ID",
  "OKX_API_KEY",
  "OKX_API_SECRET_KEY",
  "OKX_API_PASSPHRASE",
  "ENCRYPTION_KEY",
];

requiredEnvVars.forEach((env) => {
  if (!process.env[env]) {
    throw new Error(`missing ${env} environment variable`);
  }
});

// Create a bot object
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// In-memory storage for user states
const userStates = {};

// Configuration
const apiBaseUrl = "https://www.okx.com";
const xLayerChainId = "196";

// Helper functions
const updateUserState = (user, state) => {
  userStates[user.id] = { ...userStates[user.id], ...state };
};

const clearUserState = (user) => {
  delete userStates[user.id];
};

const sendReply = async (ctx, text, options = {}) => {
  const message = await ctx.reply(text, options);
  updateUserState(ctx.from, { messageId: message.message_id });
};

const handleUserState = async (ctx, handler) => {
  const userState = userStates[ctx.from.id] || {};
  if (
    ctx.message.reply_to_message &&
    ctx.message.reply_to_message.message_id === userState.messageId
  ) {
    await handler(ctx);
  } else {
    await ctx.reply("Please select an option from the menu.");
  }
};

const getRequestUrl = (path, params = {}) => {
  const url = new URL(path, apiBaseUrl);
  Object.keys(params).forEach((key) =>
    url.searchParams.append(key, params[key]),
  );
  return url.toString();
};

const getHeaders = (method, path, body = "") => {
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
};

// Bot command handlers
bot.command("start", async (ctx) => {
  const { from: user } = ctx;
  updateUserState(user, {});
  const userAddress = await getOrCreateAddress(user);

  const keyboard = new InlineKeyboard()
    .text("Check Balance", "check_balance")
    .row()
    .text("Deposit OKB", "deposit_OKB")
    .row()
    .text("Withdraw OKB", "withdraw_OKB")
    .row()
    .text("Export key", "export_key")
    .row()
    .text("Pin message", "pin_message");

  const welcomeMessage = `
  *Welcome to your XLayer Trading Bot!*
  Your XLayer address is ${userAddress}.
  Select an option below:`;

  await sendReply(ctx, welcomeMessage, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
});

// Callback query handlers
const callbackHandlers = {
  check_balance: handleCheckBalance,
  deposit_OKB: handleDeposit,
  withdraw_OKB: handleInitialWithdrawal,
  pin_message: handlePinMessage,
  export_key: handleExportKey,
};

bot.on("callback_query:data", async (ctx) => {
  const handler = callbackHandlers[ctx.callbackQuery.data];
  if (handler) {
    await ctx.answerCallbackQuery();
    await handler(ctx);
  } else {
    await ctx.reply("Unknown button clicked!");
  }
  console.log(
    `User ID: ${ctx.from.id}, Username: ${ctx.from.username}, First Name: ${ctx.from.first_name}`,
  );
});

// Handle user messages
bot.on("message:text", async (ctx) =>
  handleUserState(ctx, async () => {
    const userState = userStates[ctx.from.id] || {};
    if (userState.withdrawalRequested) await handleWithdrawal(ctx);
  }),
);

// Get or create the user's address
async function getOrCreateAddress(user) {
  if (userStates[user.id]?.address) {
    return userStates[user.id].address;
  }

  const wallet = new EthWallet();
  const mnemonic = await bip39.generateMnemonic();
  const hdPath = await wallet.getDerivedPath({ index: 0 });
  const derivePrivateKey = await wallet.getDerivedPrivateKey({
    mnemonic,
    hdPath,
  });
  const newAddress = await wallet.getNewAddress({
    privateKey: derivePrivateKey,
  });

  updateUserState(user, {
    address: newAddress.address,
    privateKey: derivePrivateKey,
    publicKey: newAddress.publicKey,
  });

  return newAddress.address;
}

// Handle checking balance
async function handleCheckBalance(ctx) {
  const userAddress = await getOrCreateAddress(ctx.from);

  try {
    const response = await fetch(
      getRequestUrl("/api/v5/wallet/asset/token-balances-by-address"),
      {
        method: "POST",
        headers: getHeaders(
          "POST",
          "/api/v5/wallet/asset/token-balances-by-address",
          JSON.stringify({
            address: userAddress,
            tokenAddresses: [
              {
                chainIndex: "196",
                tokenAddress: "",
              },
            ],
          }),
        ),
        body: JSON.stringify({
          address: userAddress,
          tokenAddresses: [
            {
              chainIndex: "196",
              tokenAddress: "",
            },
          ],
        }),
      },
    );
    const data = await response.json();
    console.log("API Response:", JSON.stringify(data, null, 2));

    if (data.code === "0" && Array.isArray(data.data) && data.data.length > 0) {
      const tokenAssets = data.data[0].tokenAssets;
      if (Array.isArray(tokenAssets) && tokenAssets.length > 0) {
        const token = tokenAssets[0];
        if (
          token &&
          token.balance !== undefined &&
          token.tokenPrice !== undefined
        ) {
          const balance = parseFloat(token.balance).toFixed(8);
          const value = (
            parseFloat(token.balance) * parseFloat(token.tokenPrice)
          ).toFixed(2);
          const symbol = token.symbol || "OKB"; // Use "OKB" if symbol is empty
          await sendReply(
            ctx,
            `Your XLayer ${symbol} balance:\n${balance} ${symbol} (USD ${value})`,
          );
        } else {
          console.error("Unexpected token data structure:", token);
          throw new Error("Invalid token data received");
        }
      } else {
        throw new Error("No token assets found");
      }
    } else {
      console.error("Unexpected API response:", data);
      throw new Error(data.msg || "No balance data received");
    }
  } catch (error) {
    console.error("Error checking balance:", error);
    await ctx.reply(
      "An error occurred while checking your balance. Please try again later.",
    );
  }
}

// Handle deposits
async function handleDeposit(ctx) {
  const userAddress = await getOrCreateAddress(ctx.from);
  await sendReply(
    ctx,
    "_Note: Make sure to deposit only to this address on the XLayer network!_",
    { parse_mode: "Markdown" },
  );
  await sendReply(ctx, "Please send your OKB to the following address:");
  await sendReply(ctx, `\`${userAddress}\``, { parse_mode: "Markdown" });
}

// Handle initial withdrawal request
async function handleInitialWithdrawal(ctx) {
  updateUserState(ctx.from, { withdrawalRequested: true });
  await sendReply(
    ctx,
    "Please respond with the amount of OKB you want to withdraw.",
    { reply_markup: { force_reply: true } },
  );
}

// Handle withdrawals
async function handleWithdrawal(ctx) {
  const userState = userStates[ctx.from.id] || {};
  if (!userState.withdrawalAmount) {
    const withdrawalAmount = parseFloat(ctx.message.text);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
      await ctx.reply(
        "Invalid withdrawal amount. Please enter a positive number.",
      );
      // clearUserState(ctx.from);
    } else {
      await sendReply(
        ctx,
        "Please respond with the XLayer address where you would like to receive the OKB.",
        { reply_markup: { force_reply: true } },
      );
      updateUserState(ctx.from, {
        withdrawalAmount,
      });
    }
  } else {
    const destination = ctx.message.text;
    const wallet = new EthWallet();
    try {
      const isValidAddress = await wallet.validAddress({
        address: destination,
      });
      if (!isValidAddress) {
        await ctx.reply("Invalid destination address. Please try again.");
        // clearUserState(ctx.from);
        return;
      }
      await sendReply(ctx, "Initiating withdrawal...");

      // Convert withdrawalAmount to wei (1 OKB = 10^18 wei)
      const txAmountInWei = `${new BigNumber(userState.withdrawalAmount).times(1e18)}`;

      const signInfoResponse = await fetch(
        getRequestUrl("/api/v5/wallet/pre-transaction/sign-info"),
        {
          method: "POST",
          headers: getHeaders(
            "POST",
            "/api/v5/wallet/pre-transaction/sign-info",
            JSON.stringify({
              chainIndex: xLayerChainId,
              fromAddr: userState.address,
              toAddr: destination,
              txAmount: txAmountInWei,
            }),
          ),
          body: JSON.stringify({
            chainIndex: xLayerChainId,
            fromAddr: userState.address,
            toAddr: destination,
            txAmount: txAmountInWei,
          }),
        },
      );
      const signInfoData = await signInfoResponse.json();
      if (signInfoData.code !== "0") {
        throw new Error(signInfoData.msg);
      }
      const txData = signInfoData.data[0];

      // Prepare transaction data
      const txParams = {
        to: destination,
        value: txAmountInWei,
        nonce: txData.nonce,
        gasPrice: txData.gasPrice.normal,
        gasLimit: txData.gasLimit,
        chainId: xLayerChainId,
      };

      console.log("Transaction params:", txParams);

      const signedTx = await wallet.signTransaction(parseInt(xLayerChainId), {
        privateKey: userState.privateKey,
        data: txParams,
      });

      console.log("Signed transaction:", signedTx);

      const broadcastResponse = await fetch(
        getRequestUrl("/api/v5/wallet/pre-transaction/broadcast-transaction"),
        {
          method: "POST",
          headers: getHeaders(
            "POST",
            "/api/v5/wallet/pre-transaction/broadcast-transaction",
            JSON.stringify({
              signedTx: signedTx,
              chainIndex: xLayerChainId,
              address: userState.address,
            }),
          ),
          body: JSON.stringify({
            signedTx: signedTx,
            chainIndex: xLayerChainId,
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
      // clearUserState(ctx.from);
    } catch (error) {
      console.error("Error during withdrawal:", error);
      await ctx.reply("An error occurred while initiating the withdrawal.");
      // clearUserState(ctx.from);
    }
  }
}
// Handle exporting the key
async function handleExportKey(ctx) {
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

// Handle pinning the start message
async function handlePinMessage(ctx) {
  try {
    await ctx.api.pinChatMessage(
      ctx.chat.id,
      userStates[ctx.from.id].messageId,
    );
    await ctx.reply("Message pinned successfully!");
  } catch (error) {
    console.error("Failed to pin the message:", error);
    await ctx.reply(
      "Failed to pin the message. Ensure the bot has the proper permissions.",
    );
  }
  // clearUserState(ctx.from);
}

// Start the bot (using long polling)
bot.start();

console.log("XLayer Trading bot is running...");
