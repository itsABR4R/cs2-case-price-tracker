const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static('public'));

// Store previous prices in a file
const PREVIOUS_PRICES_FILE = path.join(__dirname, 'previous_prices.json');

// Function to read previous prices
async function readPreviousPrices() {
    try {
        const data = await fs.readFile(PREVIOUS_PRICES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If file doesn't exist or is invalid, return empty object
        return {};
    }
}

// Function to save previous prices
async function savePreviousPrices(prices) {
    await fs.writeFile(PREVIOUS_PRICES_FILE, JSON.stringify(prices, null, 2));
}

// Function to update prices
async function updatePrices() {
    try {
        const pricesPath = path.join(__dirname, 'prices.json');
        const pricesData = await fs.readFile(pricesPath, 'utf8');
        const prices = JSON.parse(pricesData);
        
        // Read previous prices
        const previousPrices = await readPreviousPrices();
        
        // Save current prices as previous prices
        await savePreviousPrices(prices);
        
        // Add previous prices to the response
        const response = Object.entries(prices).reduce((acc, [name, info]) => {
            acc[name] = {
                ...info,
                previousPrice: previousPrices[name]?.price || null
            };
            return acc;
        }, {});
        
        return response;
    } catch (error) {
        console.error('Error updating prices:', error);
        throw error;
    }
}

// API endpoint to get cases with previous prices
app.get('/api/cases', async (req, res) => {
    try {
        const prices = await updatePrices();
        res.json(prices);
    } catch (error) {
        console.error('Error fetching cases:', error);
        res.status(500).json({ 
            error: 'Failed to fetch cases',
            details: error.message 
        });
    }
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    
    // Initial price update
    updatePrices().catch(error => {
        console.error('Initial price update failed:', error);
    });
    
    // Set up automatic price updates every 24 hours
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setInterval(() => {
        updatePrices().catch(error => {
            console.error('Scheduled price update failed:', error);
        });
    }, TWENTY_FOUR_HOURS);
});
