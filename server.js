const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const app = express();
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

// Function to update prices
async function updatePrices() {
    try {
        const pricesPath = path.join(__dirname, 'prices.json');
        const pricesData = await fs.readFile(pricesPath, 'utf8');
        const prices = JSON.parse(pricesData);
        
        // Save prices to database
        await savePrices(prices);
        
        // Get current prices from database
        const currentPrices = await getCurrentPrices();
        
        return currentPrices;
    } catch (error) {
        console.error('Error updating prices:', error);
        throw error;
    }
}

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

// Start the server
app.listen(port, async () => {
    console.log(`Server running on port ${port}`);
    
    // Initialize database
    await initializeDatabase();
    
    // Initial price update
    updatePrices().catch(error => {
        console.error('Initial price update failed:', error);
    });
    
    // Set up automatic price updates every 10 minutes
    const TEN_MINUTES = 10 * 60 * 1000;
    setInterval(() => {
        updatePrices().catch(error => {
            console.error('Scheduled price update failed:', error);
        });
    }, TEN_MINUTES);
});
