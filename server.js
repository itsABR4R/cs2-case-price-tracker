const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');
const cases = require('./cases.json');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// PostgreSQL connection configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Railway
  }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
            CREATE TABLE IF NOT EXISTS prices (
                id SERIAL PRIMARY KEY,
                case_name VARCHAR(255) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS price_history (
                id SERIAL PRIMARY KEY,
                case_name VARCHAR(255) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
    console.log('Database tables initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Function to save current prices
async function savePrices(prices) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear current prices
    await client.query('DELETE FROM prices');

    // Insert new prices
    for (const [name, info] of Object.entries(prices)) {
      await client.query(
        'INSERT INTO prices (case_name, price, timestamp) VALUES ($1, $2, $3)',
        [name, info.price, new Date(info.timestamp)]
      );

      // Also save to price history
      await client.query(
        'INSERT INTO price_history (case_name, price, timestamp) VALUES ($1, $2, $3)',
        [name, info.price, new Date(info.timestamp)]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Function to get current prices
async function getCurrentPrices() {
  const result = await pool.query('SELECT * FROM prices ORDER BY timestamp DESC');
  return result.rows.reduce((acc, row) => {
    acc[row.case_name] = {
      price: parseFloat(row.price),
      timestamp: row.timestamp.toISOString()
    };
    return acc;
  }, {});
}

// Function to get price history
async function getPriceHistory() {
  const result = await pool.query('SELECT * FROM price_history ORDER BY timestamp DESC');
  return result.rows.reduce((acc, row) => {
    if (!acc[row.case_name]) {
      acc[row.case_name] = [];
    }
    acc[row.case_name].push({
      price: parseFloat(row.price),
      timestamp: row.timestamp.toISOString()
    });
    return acc;
  }, {});
}

// --- Integrated fetchPrices logic ---
const API_URL = "https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=";
const INITIAL_SLEEP_MS = 1500; // 1.5 second delay per request
const MAX_RETRIES = 5; // Max retry attempts after hitting rate limits
const MAX_REQUESTS_PER_CYCLE = 200;
const COOLDOWN_AFTER_MAX_REQUESTS_MS = 3 * 60 * 1000; // 4 minutes

let rateLimitHits = 0; // Counter for rate limit hits
const cooldownTime = 180000; // 3 minutes in milliseconds
let isOnCooldown = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelayMs() {
  // Returns a random delay between 2700ms and 3000ms
  return 2500 + Math.random() * 250;
}

// Function to handle rate limit
function handleRateLimit() {
  rateLimitHits++;
  if (rateLimitHits >= 3) {
    console.log("Rate limit hit 3 times. Entering cooldown for 3 minutes.");
    isOnCooldown = true;
    setTimeout(() => {
      isOnCooldown = false;
      rateLimitHits = 0; // Reset the counter after cooldown
      console.log("Cooldown over. You can make requests again.");
    }, cooldownTime);
  } else {
    console.log(`Rate limit hit for Operation Broken Fang Case. Retrying in ${rateLimitHits * 3}s...`);
    // Retry logic here
  }
}

async function fetchAndStorePrices() {
  let caseCount = 0;
  let requestCount = 0;
  const now = new Date();

  for (const caseName of cases) {
    if (caseName === "Consumer Grade Container") continue;
    let attempts = 0;
    let priceFetched = false;

    // Check if we've hit the max requests for this cycle
    if (requestCount >= MAX_REQUESTS_PER_CYCLE) {
      console.log(`\n🚦 Hit ${MAX_REQUESTS_PER_CYCLE} requests. Cooling down for 3 minutes...\n`);
      await sleep(COOLDOWN_AFTER_MAX_REQUESTS_MS);
      requestCount = 0;
    }

    while (attempts < MAX_RETRIES && !priceFetched) {
      const url = API_URL + encodeURIComponent(caseName);
      try {
        await client.query('BEGIN');
        // Remove any existing price for this case
        await client.query('DELETE FROM prices WHERE case_name = $1', [caseName]);
        await client.query(
          'INSERT INTO prices (case_name, price, timestamp) VALUES ($1, $2, $3)',
          [caseName, price, timestamp]
        );
        await client.query(
          'INSERT INTO price_history (case_name, price, timestamp) VALUES ($1, $2, $3)',
          [caseName, price, timestamp]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      // Emit per-case update
      io.emit('price-updated', { caseName, price, timestamp });
      console.log(`Fetched: ${caseName} — $${price.toFixed(2)}`);
      priceFetched = true;
      caseCount++;
      requestCount++;

      // Add cooldown after every 20 cases fetched
      if (caseCount % 20 === 0) {
        console.log(`\n🚦 Fetched ${caseCount} cases. Cooling down for 30 seconds...\n`);
        await sleep(10000); // 30 seconds cooldown
      }
    } catch (e) {
      if (e.response && e.response.status === 429) {
        attempts++;
        const backoffTime = Math.pow(2, attempts) * INITIAL_SLEEP_MS; // Exponential backoff
        console.warn(`Rate limit hit for ${caseName}. Retrying in ${backoffTime / 1000}s...`);
        await sleep(backoffTime); // Wait before retrying
      } else {
        console.error(`Failed to fetch ${caseName}:`, e.message);
        break;
      }
    }
  }

  if (!priceFetched) {
    console.error(`Failed to fetch ${caseName} after ${MAX_RETRIES} attempts.`);
  }

  await sleep(randomDelayMs());
}

io.emit('prices-updated', { timestamp: new Date().toISOString() });
console.log("\n✨ Successfully completed fetching all case prices!");
console.log(`📊 Total cases processed: ${caseCount}`);
}

// --- End fetchPrices logic ---

// API endpoint to get cases with previous prices
app.get('/api/cases', async (req, res) => {
  try {
    const prices = await getCurrentPrices();
    res.json(prices);
  } catch (error) {
    console.error('Error fetching cases:', error);
    res.status(500).json({
      error: 'Failed to fetch cases',
      details: error.message
    });
  }
});

// API endpoint to get price history
app.get('/api/prices-history', async (req, res) => {
  try {
    const history = await getPriceHistory();
    res.json(history);
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({
      error: 'Failed to fetch price history',
      details: error.message
    });
  }
});

// Serve static files from the public directory
app.use(express.static('public'));

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

async function startPriceFetchLoop() {
  while (true) {
    await fetchAndStorePrices();
    // No cooldown here; handled in fetchAndStorePrices if 200 requests are hit
  }
}

// Start the server
server.listen(port, async () => {
  console.log(`Server running on port ${port}`);

  // Initialize database
  await initializeDatabase();

  // Initial price fetch and store
  await fetchAndStorePrices();

  // Set up automatic price updates every 3 minutes
  startPriceFetchLoop();
});
