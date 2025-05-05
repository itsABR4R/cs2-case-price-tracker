document.addEventListener("DOMContentLoaded", async () => {
    let casesArray = []; // Store cases data globally
    let previousTimestamp = null;
    let currentCurrency = 'USD';
    let usdToBdtRate = 0;
    let requestCount = 0; // <-- global, persists across cycles

    // Add last updated timestamp element
    const main = document.querySelector('main');
    let lastUpdatedElem = document.getElementById('last-updated');
    if (!lastUpdatedElem) {
        lastUpdatedElem = document.createElement('div');
        lastUpdatedElem.id = 'last-updated';
        lastUpdatedElem.style.textAlign = 'center';
        lastUpdatedElem.style.margin = '10px 0';
        main.insertBefore(lastUpdatedElem, main.firstChild);
    }

    async function fetchUsdToBdtRate() {
        try {
            const res = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=BDT');
            const data = await res.json();
            if (data && data.rates && data.rates.BDT) {
                usdToBdtRate = data.rates.BDT;
            } else {
                usdToBdtRate = 117; // fallback to a static rate if API fails
            }
        } catch (e) {
            usdToBdtRate = 117; // fallback
        }
    }

    function formatPrice(price) {
        if (currentCurrency === 'USD') {
            return `$${price.toFixed(2)}`;
        } else if (currentCurrency === 'BDT') {
            return `৳${(price * usdToBdtRate).toFixed(2)}`;
        }
        return price;
    }

    async function fetchAndUpdateCases() {
        const casesGrid = document.querySelector(".cases-grid");
        try {
            // Show loading spinner/message
            casesGrid.innerHTML = `<div class="loading-spinner" style="text-align:center;grid-column:1/-1;padding:2em;">
                <span class="spinner" style="display:inline-block;width:32px;height:32px;border:4px solid #ccc;border-top:4px solid #333;border-radius:50%;animation:spin 1s linear infinite;vertical-align:middle;"></span>
                <br>Updating prices, please wait…
            </div>`;
            // Add spinner animation style if not present
            if (!document.getElementById('spinner-style')) {
                const style = document.createElement('style');
                style.id = 'spinner-style';
                style.innerHTML = `@keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}`;
                document.head.appendChild(style);
            }

            console.log("Fetching cases from API...");
            const [pricesResponse, casesResponse, historyResponse] = await Promise.all([
                fetch("/api/cases"),
                fetch("https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json"),
                fetch("/api/prices-history")
            ]);

            if (!pricesResponse.ok) {
                const errorData = await pricesResponse.json();
                throw new Error(`Server error: ${errorData.error}${errorData.details ? ` - ${errorData.details}` : ''}`);
            }

            if (!casesResponse.ok) {
                throw new Error("Failed to fetch case data from CSGO-API");
            }

            if (!historyResponse.ok) {
                throw new Error("Failed to fetch price history");
            }

            const pricesData = await pricesResponse.json();
            const casesData = await casesResponse.json();
            const historyData = await historyResponse.json();
            console.log("Received data:", pricesData);

            // Find the latest timestamp from pricesData
            let latestTimestamp = null;
            for (const info of Object.values(pricesData)) {
                if (!latestTimestamp || new Date(info.timestamp) > new Date(latestTimestamp)) {
                    latestTimestamp = info.timestamp;
                }
            }
            if (latestTimestamp) {
                const date = new Date(latestTimestamp);
                lastUpdatedElem.textContent = `Last updated: ${date.toLocaleString()}`;
                previousTimestamp = latestTimestamp;
            } else {
                lastUpdatedElem.textContent = '';
            }

            casesGrid.innerHTML = ''; // Clear loading message

            if (!pricesData || Object.keys(pricesData).length === 0) {
                throw new Error("No case data received");
            }

            // Convert data to array and sort by name, excluding Consumer Grade Container
            casesArray = Object.entries(pricesData)
                .filter(([name]) => name !== "Consumer Grade Container")
                .map(([name, info]) => {
                    // Find matching case from CSGO-API
                    const caseInfo = casesData.find(c => c.name === name);
                    const history = historyData[name] || [];
                    const now = new Date();
                    // Find the latest price (current) from pricesData
                    const currentPrice = info.price;
                    // Find the price from (or closest to) 1 hour ago from historyData
                    const targetTime = now.getTime() - 1 * 60 * 60 * 1000;
                    let price1hAgo = null;
                    let minDiff = Infinity;
                    for (const record of history) {
                        const recordTime = new Date(record.timestamp).getTime();
                        const diff = Math.abs(recordTime - targetTime);
                        if (diff < minDiff && recordTime <= now.getTime()) {
                            minDiff = diff;
                            price1hAgo = record.price;
                        }
                    }
                    let priceChange = null;
                    if (price1hAgo !== null && price1hAgo !== 0) {
                        priceChange = ((currentPrice - price1hAgo) / price1hAgo) * 100;
                    }
                    return {
                        name,
                        price: currentPrice, // Always use info.price from pricesData
                        price1hAgo,
                        priceChange,
                        timestamp: info.timestamp,
                        image: caseInfo?.image || null
                    };
                });

            // Sort cases by name initially
            casesArray.sort((a, b) => a.name.localeCompare(b.name));

            // Render the cases
            renderCases(casesArray);

        } catch (error) {
            console.error("Failed to fetch case data:", error);
            const casesGrid = document.querySelector(".cases-grid");
            casesGrid.innerHTML = `
                <div style="color: red; text-align: center; grid-column: 1 / -1;">
                    Error: ${error.message}<br>
                    Please check the console for more details.
                </div>
            `;
            lastUpdatedElem.textContent = '';
        }
    }

    function renderCases(cases) {
        const casesGrid = document.querySelector(".cases-grid");
        casesGrid.innerHTML = '';
        cases.forEach(csCase => {
            const card = document.createElement("div");
            card.className = "case-card";
            card.setAttribute('data-case-name', csCase.name);

            const priceChangeText = csCase.priceChange !== null 
                ? `${csCase.priceChange >= 0 ? '+' : ''}${csCase.priceChange.toFixed(2)}%`
                : 'N/A';

            const priceChangeClass = csCase.priceChange !== null
                ? csCase.priceChange >= 0 ? 'positive' : 'negative'
                : '';

            card.innerHTML = `
                <img src="${csCase.image || 'https://steamcommunity-a.akamaihd.net/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot621FARpnaLLJTwW09-3h5TZlvD7PYTZk2pH8fp9i_vG8Y_2j1Gx5UY4Yz_3J4euc1G7Yw5qYw-1r1G7gO3q0hK3v8nN2nA/360fx360f'}" 
                     alt="${csCase.name}" 
                     class="case-image"
                     onerror="this.src='https://steamcommunity-a.akamaihd.net/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot621FARpnaLLJTwW09-3h5TZlvD7PYTZk2pH8fp9i_vG8Y_2j1Gx5UY4Yz_3J4euc1G7Yw5qYw-1r1G7gO3q0hK3v8nN2nA/360fx360f'">
                <div class="case-name">${csCase.name}</div>
                <div class="case-price" data-case-price="${csCase.name}">${formatPrice(csCase.price)}</div>
                <div class="case-change ${priceChangeClass}">
                    ${priceChangeText}
                    ${csCase.price1hAgo !== null ? `<br><span class="previous-price">${formatPrice(csCase.price1hAgo)}</span>` : ''}
                </div>
        `;

            casesGrid.appendChild(card);
        });
    }

    // Initial fetch
    await fetchAndUpdateCases();

    // Currency dropdown logic
    const currencySelect = document.getElementById('currency');
    currencySelect.addEventListener('change', async (e) => {
        currentCurrency = e.target.value;
        if (currentCurrency === 'BDT') {
            await fetchUsdToBdtRate();
        }
        renderCases(casesArray);
    });

    // Search functionality
    const searchInput = document.getElementById("search");
    searchInput.addEventListener("input", (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredCases = casesArray.filter(csCase => 
            csCase.name.toLowerCase().includes(searchTerm)
        );
        renderCases(filteredCases);
    });

    // Sort functionality
    const sortSelect = document.getElementById("sort");
    sortSelect.addEventListener("change", (e) => {
        const sortBy = e.target.value;
        let sortedCases;
        if (sortBy === "name") {
            sortedCases = [...casesArray].sort((a, b) => a.name.localeCompare(b.name));
        } else if (sortBy === "price" || sortBy === "price-desc") {
            sortedCases = [...casesArray].sort((a, b) => b.price - a.price);
        } else if (sortBy === "price-asc") {
            sortedCases = [...casesArray].sort((a, b) => a.price - b.price);
        } else {
            sortedCases = [...casesArray];
        }
        renderCases(sortedCases);
    });

    // --- Socket.IO real-time updates ---
    if (window.io) {
        const socket = io();
        socket.on('price-updated', ({ caseName, price, timestamp, percentChange }) => {
            const priceElem = document.querySelector(`[data-case-price="${caseName}"]`);
            if (priceElem) {
                // Add loading animation
                priceElem.classList.add('loading');
                // Show spinner while updating
                priceElem.innerHTML = '<span class="price-spinner"></span>';
        
                // After a short delay, update the price and percent change
                setTimeout(() => {
                    const changeText = percentChange !== null 
                        ? ` (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}%)` 
                        : '';
                    priceElem.textContent = formatPrice(price) + changeText;
                    priceElem.classList.remove('loading');
                }, 500); // 0.5s for smoothness
            }
        });
    }

    async function startPriceFetchLoop() {
        while (true) {
            await fetchAndUpdateCases();
            if (requestCount >= MAX_REQUESTS_PER_CYCLE) {
                console.log(`\n🚦 Hit ${MAX_REQUESTS_PER_CYCLE} requests. Cooling down for 3 minutes...\n`);
                await sleep(COOLDOWN_AFTER_MAX_REQUESTS_MS);
                requestCount = 0;
            }
        }
    }

});
  