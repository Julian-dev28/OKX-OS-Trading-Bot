const crypto = require("crypto");
const fetch = require("node-fetch");

// Constants
const API_BASE_URL = "https://www.okx.com";
const CHAIN_ID = "196";

// Environment check
const REQUIRED_ENV = [
    "OKX_API_KEY",
    "OKX_API_SECRET_KEY",
    "OKX_API_PASSPHRASE",
    "OKX_PROJECT_ID",
];

for (const env of REQUIRED_ENV) {
    if (!process.env[env]) {
        console.error(`Error: Missing ${env} environment variable`);
        process.exit(1);
    }
}

function getRequestUrl(path, params = {}) {
    const url = new URL(path, API_BASE_URL);
    Object.entries(params).forEach(([key, value]) =>
        url.searchParams.append(key, value),
    );
    return url.toString();
}

function getHeaders(method, path, params = {}) {
    const timestamp = new Date().toISOString();
    const queryString = new URLSearchParams(params).toString();
    const pathWithQuery = queryString ? `${path}?${queryString}` : path;
    const signString = timestamp + method.toUpperCase() + pathWithQuery;

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

function formatTxStatus(status) {
    const statusMap = {
        0: "Processing",
        1: "Pending",
        2: "Success",
        3: "Failed",
    };
    return statusMap[status] || "Unknown";
}

function formatTransaction(tx) {
    if (!tx) return null;

    return {
        status: formatTxStatus(tx.txStatus),
        orderId: tx.orderId,
        hash: tx.txhash || "Pending",
        blockHeight: tx.blockHeight || "Pending",
        blockTime: tx.blockTime
            ? new Date(parseInt(tx.blockTime)).toLocaleString()
            : "Pending",
        gasUsed: tx.gasUsed || "0",
        gasLimit: tx.gasLimit || "0",
        gasPrice: tx.gasPrice ? `${tx.gasPrice} Gwei` : "Pending",
        fee: tx.feeUsdValue ? `$${tx.feeUsdValue}` : "Pending",
        fromAddr: tx.txDetail?.[0]?.fromAddr || "N/A",
        toAddr: tx.txDetail?.[0]?.toAddr || "N/A",
    };
}

async function checkTransaction(accountId, orderId) {
    const params = {
        accountId,
        orderId,
        chainIndex: CHAIN_ID,
    };

    try {
        const path = "/api/v5/wallet/post-transaction/orders";
        const url = getRequestUrl(path, params);
        const headers = getHeaders("GET", path, params);

        console.log("\nFetching transaction details...");
        const response = await fetch(url, { method: "GET", headers });
        const data = await response.json();

        if (data.code !== "0") {
            throw new Error(`API Error: ${data.msg || "Unknown error"}`);
        }

        if (!data.data || data.data.length === 0) {
            console.log("\nTransaction Status: Processing");
            console.log(`Order ID: ${orderId}`);
            console.log("Message: Transaction is still being processed");
            return;
        }

        const txInfo = formatTransaction(data.data[0]);

        console.log("\nTransaction Details:");
        console.log("==================");
        Object.entries(txInfo).forEach(([key, value]) => {
            console.log(`${key.padEnd(12)}: ${value}`);
        });

        return data;
    } catch (error) {
        console.error("\nError fetching transaction:", error.message);
        throw error;
    }
}

async function main() {
    const accountId = process.argv[2];
    const orderId = process.argv[3];

    if (!accountId || !orderId) {
        console.error("\nError: Missing required parameters");
        console.error("Usage: node check.js <accountId> <orderId>");
        process.exit(1);
    }

    try {
        console.log(`\nChecking transaction: ${orderId}`);
        console.log(`Account ID: ${accountId}`);
        await checkTransaction(accountId, orderId);
    } catch (error) {
        console.error("\nScript execution failed:", error.message);
        process.exit(1);
    }
}

main().catch(console.error);
