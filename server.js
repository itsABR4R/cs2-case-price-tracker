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
const COOLDOWN_AFTER_MAX_RETRIES = 3 * 60 * 1000;
const COOLDOWN_AFTER_MAX_REQUESTS_MS = 3 * 60 * 1000; // 4 minutes

let rateLimitHits = 0; // Counter for rate limit hits
const cooldownTime = 180000; // 3 minutes in milliseconds
let isOnCooldown = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelayMs() {
  // Returns a random delay between 1.5 seconds and 1.8 seconds
  return 1500 + Math.random() * 300;
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
  let cycleCount = 0; // Counter for cycles

  for (const caseName of cases) {
    if (caseName === "Consumer Grade Container") continue;
    let attempts = 0;
    let priceFetched = false;

    while (attempts < MAX_RETRIES && !priceFetched) {
      const url = API_URL + encodeURIComponent(caseName);
      try {
        const res = await axios.get(url);
        const priceStr = res.data.lowest_price || "$0.00";
        const newPrice = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
        const timestamp = now.toISOString();

        // Fetch the previous price from the database
        const previousPriceResult = await pool.query('SELECT price FROM prices WHERE case_name = $1', [caseName]);
        const previousPrice = previousPriceResult.rows.length > 0 ? previousPriceResult.rows[0].price : null;

        // Save to DB immediately
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM prices WHERE case_name = $1', [caseName]);
          await client.query(
            'INSERT INTO prices (case_name, price, timestamp) VALUES ($1, $2, $3)',
            [caseName, newPrice, timestamp]
          );
          await client.query(
            'INSERT INTO price_history (case_name, price, timestamp) VALUES ($1, $2, $3)',
            [caseName, newPrice, timestamp]
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        // Calculate percentage change if previous price exists
        let percentChange = null;
        if (previousPrice !== null) {
          percentChange = ((newPrice - previousPrice) / previousPrice) * 100;
        }

        // Emit per-case update with price and percent change
        io.emit('price-updated', { caseName, price: newPrice, timestamp, percentChange });
        console.log(`Fetched: ${caseName} — $${newPrice.toFixed(2)} (Change: ${percentChange ? percentChange.toFixed(2) + '%' : 'N/A'})`);
        
        priceFetched = true;
        caseCount++;
        requestCount++;

        // Check if 20 cases have been fetched
        if (caseCount % 20 === 0) {
          console.log(`\n🚦 Fetched ${caseCount} cases. Taking a 30-second break...\n`);
          await sleep(30000); // 30 seconds cooldown
        }

        // Check if 40 cases have been fetched (1 cycle)
        if (caseCount % 40 === 0) {
          cycleCount++; // Increment cycle count
          console.log(`\n🚦 Completed cycle ${cycleCount}. Taking a 5-minute break...\n`);
          await sleep(5 * 60 * 1000); // 5 minutes cooldown
        }
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
    
        // Check if max retries have been reached
        if (attempts >= MAX_RETRIES) {
            console.warn(`Max retries reached for ${caseName}. Cooling down for 3 minutes...`);
            await sleep(COOLDOWN_AFTER_MAX_RETRIES); // Cooldown after max retries
        }
      }
    }

    await sleep(randomDelayMs()); // Random delay between requests
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