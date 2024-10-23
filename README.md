# Telegram Trading Bot

This provides a template for Telegram trading bot on X Layer Mainnet that uses and [Wallet APIs](https://docs.cdp.coinbase.com/mpc-wallet/docs/welcome), and [Dex APIs](https://www.okx.com/web3/build/docs/waas/dex-introduction) from  [OKX OS]([https://www.okx.com/web3/build/docs/waas/okx-waas-what-is-waas](https://www.okx.com/web3/build)) 

It stores wallet data in a the local Replit database.

> **NOTE: This sample app is for demonstration purposes only.** Make sure to persist your
> private keys, and deposit only small amounts of ETH to reduce the risk of losing your funds.


<!-- **Secure your wallet using [best practices](https://docs.cdp.coinbase.com/mpc-wallet/docs/wallets#securing-a-wallet). In production, you should [use the 2-of-2 CDP Server-Signer](https://docs.cdp.coinbase.com/mpc-wallet/docs/serversigners) with [IP whitelisting for your API key](https://docs.cdp.coinbase.com/developer-platform/docs/cdp-key-security) for increased security.** -->


## Feature requests

If there is specific functionality you'd like to see in OKX OS that is missing,
please [file it as an issue](https://github.com/okx/js-wallet-sdk/issues), and we will get back to you as soon as possible.

You can also contact us via the [OKX OS Discord Channel](https://discord.com/channels/1260193012223578164/1267467417848643585).

## Set Up

1. Click "Use Template" to fork this repl.

2. Provision a [OKX OS API Key](https://www.okx.com/web3/build/dev-portal).
3. Provision a [Telegram Bot Token](https://core.telegram.org/bots/tutorial) and register your Bot.
4. Generate a 32-byte encryption key using OpenSSL:

```bash
openssl rand -hex 32 # Save the output to use as the encryption key in Step 5.
```

5. Set the following environment variables via a `.env` file or the Replit Secret Manager:

```bash
TELEGRAM_BOT_TOKEN="Your Telegram Bot Token"
OKX_PROJECT_ID="Your OKX API Project ID"
OKX_API_KEY="Your OKX API Key"
OKX_API_SECRET_KEY="Your OKX API Key Private Key"
OKX_API_PASSPHRASE="Your OKX API Key Passphrase"
ENCRYPTION_KEY="Your hex-encoded encryption key"
```

6. Run the project:

```
npm install
npm run start
```

7. Send the `/start` message to the Bot you provisioned in Step 3 on Telegram, and start trading!

8. Optionally deploy the project to keep it running.