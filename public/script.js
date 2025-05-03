document.addEventListener("DOMContentLoaded", async () => {
    let casesArray = []; // Store cases data globally

    async function fetchAndUpdateCases() {
    try {
        console.log("Fetching cases from API...");
            const [pricesResponse, casesResponse, historyResponse, lastUpdatedResponse] = await Promise.all([
                fetch("/api/cases"),
                fetch("https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json"),
                fetch("/api/prices-history"),
                fetch("/api/last-updated")
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

            if (!lastUpdatedResponse.ok) {
                throw new Error("Failed to fetch last updated timestamp");
            }

            const pricesData = await pricesResponse.json();
            const casesData = await casesResponse.json();
            const historyData = await historyResponse.json();
            const { lastUpdated } = await lastUpdatedResponse.json();

            // Show last updated timestamp
            const lastUpdatedDiv = document.getElementById('last-updated');
            if (lastUpdated) {
                lastUpdatedDiv.textContent = `Prices last fully updated: ${new Date(lastUpdated).toLocaleString()}`;
            } else {
                lastUpdatedDiv.textContent = 'Updating prices...';
            }

            console.log("Received data:", pricesData);
      
            const casesGrid = document.querySelector(".cases-grid");
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
        }
    }

    // Function to render cases
    function renderCases(cases) {
        const casesGrid = document.querySelector(".cases-grid");
        casesGrid.innerHTML = '';
        cases.forEach(csCase => {
            const card = document.createElement("div");
            card.className = "case-card";

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
                <div class="case-price">$${csCase.price.toFixed(2)}</div>
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

    // Set up automatic updates every 10 minutes
    const TEN_MINUTES = 10 * 60 * 1000; // 10 minutes in milliseconds
    setInterval(fetchAndUpdateCases, TEN_MINUTES);

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
});
  