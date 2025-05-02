const fs = require("fs");
const axios = require("axios");
const cases = require("./cases.json");

const API_URL = "https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=";
const INITIAL_SLEEP_MS = 1000; // 1 second delay per request
const MAX_RETRIES = 5; // Max retry attempts after hitting rate limits

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPrices() {
  const result = {};

  for (const caseName of cases) {
    let attempts = 0;
    let priceFetched = false;

    while (attempts < MAX_RETRIES && !priceFetched) {
      const url = API_URL + encodeURIComponent(caseName);
      try {
        const res = await axios.get(url);
        const priceStr = res.data.lowest_price || "$0.00";
        const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
        result[caseName] = {
          price: price,
          timestamp: new Date().toISOString()
        };
        console.log(`Fetched: ${caseName} — $${price.toFixed(2)}`);
        priceFetched = true;
      } catch (e) {
        if (e.response && e.response.status === 429) {
          attempts++;
          const backoffTime = Math.pow(2, attempts) * INITIAL_SLEEP_MS; // Exponential backoff
          console.warn(`Rate limit hit for ${caseName}. Retrying in ${backoffTime / 1000}s...`);
          await sleep(backoffTime); // Wait before retrying
        } else {
          console.error(`Failed to fetch ${caseName}:`, e.message);
          break; // Stop retrying for other types of errors
        }
      }
    }

    if (!priceFetched) {
      console.error(`Failed to fetch ${caseName} after ${MAX_RETRIES} attempts.`);
    }

    await sleep(INITIAL_SLEEP_MS); // Delay between successful requests
  }

  fs.writeFileSync("prices.json", JSON.stringify(result, null, 2));
  console.log("✅ All prices updated and saved to prices.json");
}

fetchPrices();
