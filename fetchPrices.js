const fs = require("fs");
const axios = require("axios");
const cases = require("./cases.json");

const API_URL = "https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=";
const INITIAL_SLEEP_MS = 1000; // 1 second delay per request
const MAX_RETRIES = 5; // Max retry attempts after hitting rate limits
const CASES_BEFORE_TIMEOUT = 20; // Number of cases before taking a break
const TIMEOUT_DURATION_MS = 30000; // 30 seconds timeout
const HISTORY_FILE = "prices_history.json";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  }
  return {};
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

async function fetchPrices() {
  const result = {};
  let caseCount = 0;
  const history = loadHistory();
  const now = new Date();

  for (const caseName of cases) {
    let attempts = 0;
    let priceFetched = false;

    // Check if we need to take a timeout
    if (caseCount > 0 && caseCount % CASES_BEFORE_TIMEOUT === 0) {
      console.log(`\n⏳ Taking a ${TIMEOUT_DURATION_MS/1000} second break after ${caseCount} cases...\n`);
      await sleep(TIMEOUT_DURATION_MS);
    }

    while (attempts < MAX_RETRIES && !priceFetched) {
      const url = API_URL + encodeURIComponent(caseName);
      try {
        const res = await axios.get(url);
        const priceStr = res.data.lowest_price || "$0.00";
        const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
        result[caseName] = {
          price: price,
          timestamp: now.toISOString()
        };
        // Append to history
        if (!history[caseName]) history[caseName] = [];
        history[caseName].push({ price, timestamp: now.toISOString() });
        console.log(`Fetched: ${caseName} — $${price.toFixed(2)}`);
        priceFetched = true;
        caseCount++;
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
  saveHistory(history);
  console.log("\n✨ Successfully completed fetching all case prices!");
  console.log(`📊 Total cases processed: ${caseCount}`);
  console.log("💾 Prices saved to prices.json and prices_history.json");
}

fetchPrices();
