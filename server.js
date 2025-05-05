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
        case_name VARCHAR(255) NOT NULL UNIQUE,
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelayMs() {
  return 2500 + Math.random() * 250;
}

const API_URL = "https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=";
const INITIAL_SLEEP_MS = 1500;
const MAX_RETRIES = 5;
const MAX_REQUESTS_PER_CYCLE = 200;
const COOLDOWN_AFTER_MAX_REQUESTS_MS = 3 * 60 * 1000;

async function fetchAndStorePrices() {
  let caseCount = 0;
  let requestCount = 0;

  for (const caseName of cases) {
    if (caseName === "Consumer Grade Container") continue;
    let attempts = 0;
    let priceFetched = false;

    if (requestCount >= MAX_REQUESTS_PER_CYCLE) {
      console.log(`\n🚦 Hit ${MAX_REQUESTS_PER_CYCLE} requests. Cooling down for 3 minutes...\n`);
      await sleep(COOLDOWN_AFTER_MAX_REQUESTS_MS);
      requestCount = 0;
    }

    while (attempts < MAX_RETRIES && !priceFetched) {
      const url = API_URL + encodeURIComponent(caseName);
      try {
        const res = await axios.get(url);
        const priceStr = res.data.lowest_price || "$0.00";
        const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
        const timestamp = new Date().toISOString();

        const client = await pool.connect();
        let previousPrice = null;
        try {
          await client.query('BEGIN');

          const prevResult = await client.query('SELECT price FROM prices WHERE case_name = $1', [caseName]);
          if (prevResult.rows.length > 0) {
            previousPrice = parseFloat(prevResult.rows[0].price);
          }

          await client.query(`
            INSERT INTO prices (case_name, price, timestamp)
            VALUES ($1, $2, $3)
            ON CONFLICT (case_name)
            DO UPDATE SET price = EXCLUDED.price, timestamp = EXCLUDED.timestamp;
          `, [caseName, price, timestamp]);

          await client.query(
            'INSERT INTO price_history (case_name, price, timestamp) VALUES ($1, $2, $3)',
            [caseName, price, timestamp]
          );

          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }

        let percentChange = null;
        if (previousPrice !== null && previousPrice !== 0) {
          percentChange = ((price - previousPrice) / previousPrice) * 100;
        }

        io.emit('price-updated', {
          caseName,
          price,
          timestamp,
          percentChange: percentChange !== null ? percentChange : null
        });

        console.log(`Fetched: ${caseName} — $${price.toFixed(2)}${percentChange !== null ? ` (${percentChange.toFixed(2)}%)` : ""}`);
        priceFetched = true;
        caseCount++;
        requestCount++;

        if (caseCount % 20 === 0) {
          console.log(`\n🚦 Fetched ${caseCount} cases. Cooling down for 10 seconds...\n`);
          await sleep(10000);
        }
      } catch (e) {
        if (e.response && e.response.status === 429) {
          attempts++;
          const backoffTime = Math.pow(2, attempts) * INITIAL_SLEEP_MS;
          console.warn(`Rate limit hit for ${caseName}. Retrying in ${backoffTime / 1000}s...`);
          await sleep(backoffTime);
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

app.get('/api/cases', async (req, res) => {
  try {
    const prices = await getCurrentPrices();
    res.json(prices);
  } catch (error) {
    console.error('Error fetching cases:', error);
    res.status(500).json({ error: 'Failed to fetch cases', details: error.message });
  }
});

app.get('/api/prices-history', async (req, res) => {
  try {
    const history = await getPriceHistory();
    res.json(history);
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Failed to fetch price history', details: error.message });
  }
});

app.use(express.static('public'));

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

async function startPriceFetchLoop() {
  while (true) {
    await fetchAndStorePrices();
  }
}

server.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  await initializeDatabase();
  await fetchAndStorePrices();
  startPriceFetchLoop();
});
