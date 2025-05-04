document.addEventListener("DOMContentLoaded", async () => {
    let casesArray = []; // Store cases data globally
    let previousTimestamp = null;

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
                // If the timestamp has changed (prices just updated), show reload prompt
                
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
                    // Find the price from (or closest to) 24 hours ago from historyData
                    const targetTime = now.getTime() - 24 * 60 * 60 * 1000;
                    let price24hAgo = null;
                    let minDiff = Infinity;
                    for (const record of history) {
                        const recordTime = new Date(record.timestamp).getTime();
                        const diff = Math.abs(recordTime - targetTime);
                        if (diff < minDiff && recordTime <= now.getTime()) {
                            minDiff = diff;
                            price24hAgo = record.price;
                        }
                    }
                    let priceChange = null;
                    if (price24hAgo !== null && price24hAgo !== 0) {
                        priceChange = ((currentPrice - price24hAgo) / price24hAgo) * 100;
                    }
                    return {
                        name,
                        price: currentPrice, // Always use info.price from pricesData
                        price24hAgo,
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

    // Function to render cases
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
                <div class="case-price" data-case-price="${csCase.name}">$${csCase.price.toFixed(2)}</div>
                <div class="case-change ${priceChangeClass}">
                    ${priceChangeText}
                    ${csCase.price24hAgo !== null ? `<br><span class="previous-price">$${csCase.price24hAgo.toFixed(2)}</span>` : ''}
                </div>
        `;

            casesGrid.appendChild(card);
        });
    }

    // Initial fetch
    await fetchAndUpdateCases();


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
        const sortedCases = [...casesArray].sort((a, b) => {
            if (sortBy === "name") {
                return a.name.localeCompare(b.name);
            } else if (sortBy === "price") {
                return b.price - a.price;
            }
        });
        renderCases(sortedCases);
    });

    // --- Socket.IO real-time updates ---
    if (window.io) {
        const socket = io();
        
        socket.on('price-updated', ({ caseName, price, timestamp }) => {
            // Find the price element for this case
            const priceElem = document.querySelector(`[data-case-price="${caseName}"]`);
            if (priceElem) {
                // Add loading animation
                priceElem.classList.add('loading');
                // Show spinner while updating
                priceElem.innerHTML = '<span class="price-spinner"></span>';
                // After a short delay, update the price (simulate fetch time)
                setTimeout(() => {
                    priceElem.textContent = `$${price.toFixed(2)}`;
                    priceElem.classList.remove('loading');
                }, 500); // 0.5s for smoothness
            }
        });
    }

});
  