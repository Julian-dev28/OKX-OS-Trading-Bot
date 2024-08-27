import { Bot } from "grammy";

// Create a bot object
const bot = new Bot(process.env.BOT_TOKEN); // <-- place your bot token in this string

// Register listeners to handle messages
bot.on("message:text", (ctx) => ctx.reply("CDP: " + ctx.message.text));

// Start the bot (using long polling)
bot.start();
