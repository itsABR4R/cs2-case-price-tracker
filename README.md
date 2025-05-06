
# CS2 Case Price Tracker

A real-time web application that tracks and stores prices for CS2 (Counter-Strike 2) weapon cases using the Steam Market API. It fetches and stores prices in a PostgreSQL database, displays historical trends, and sends live updates via Socket.IO.

## Features

- 📈 Real-time price updates via Socket.IO
- 🕒 Historical price logging with timestamps
- 💾 PostgreSQL database integration
- 🌐 Public API endpoints for frontend use
- ☁️ Railway-compatible (cloud-ready deployment)
- ⏱ Rate-limiting and retry logic for Steam API compliance
## Live Demo



https://cs2-case-price.up.railway.app/
## Tech Stack

- **Node.js**
- **Express**
- **Socket.IO**
- **Axios**
- **PostgreSQL**
- **Steam Market Price API**
- **Hosted on Railway**
## Installation

**Clone the Repository**
   ```bash
   git clone https://github.com/itsABR4R/cs2-case-price-tracker.git
   cd cs2-case-price-tracker
   ```
**Install Dependencies**
   ```bash
   npm install
   ```
**Set Environment Variables**
 
 Create a .env file in the root directory and add:
    
    DATABASE_URL=your_postgresql_connection_url

**Run the Server**
   ```bash
   node index.js
   ```
   

## API Endpoint



| Method | Endpoint     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `GET`      | `/api/cases` | Get current prices for all cases |
| `GET`      | `/api/prices-history` | Get historical price data |
| `GET`      | `/api/health` | Health check for Railway |




## Steam API

This project uses the official Steam Market Price Overview API:
```ruby
https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=CASE_NAME
```
Example:
```ruby
https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=Revolution%20Case
```
## Acknowledgements

 - Thanks to ByMykel/CSGO-API for maintaining a comprehensive and up-to-date list of CS2/CSGO item names (```bash market_hash_name ```), which is essential for fetching prices from the Steam Market API.
 - Steam Community Market for providing the public API.

