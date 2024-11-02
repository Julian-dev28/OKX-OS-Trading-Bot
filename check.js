const crypto = require("crypto");
const fetch = require("node-fetch");

// Constants
const API_BASE_URL = "https://www.okx.com";
const CHAIN_ID = "196";

// Environment check
if (
    !process.env.OKX_API_KEY ||
    !process.env.OKX_API_SECRET_KEY ||
    !process.env.OKX_API_PASSPHRASE ||
    !process.env.OKX_PROJECT_ID
) {
    throw new Error("Missing environment variables");
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

    const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join("&");

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

async function checkTransaction(orderId) {
    // Added accountId parameter
    const params = {
        orderId: orderId,
        chainIndex: CHAIN_ID,
        accountId: process.env.OKX_PROJECT_ID, // Add accountId to params
    };

    try {
        const path = "/api/v5/wallet/post-transaction/orders";
        const url = getRequestUrl(path, params);

        const headers = getHeaders("GET", path, params);

        const response = await fetch(url, {
            method: "GET",
            headers: headers,
        });

        const data = await response.json();
        console.log("Transaction Details:", JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        console.error("Error fetching transaction:", error);
        throw error;
    }
}

async function main() {
    const orderId = process.argv[2];
    // const accountId = process.argv[3]; // Get accountId as second argument

    if (!orderId) {
        console.error("Please provide both orderId");
        console.error("Usage: node s.js <orderId>");
        process.exit(1);
    }

    console.log(`Checking transaction ${orderId}`);
    await checkTransaction(orderId);
}

main().catch(console.error);
