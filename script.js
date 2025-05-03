document.addEventListener("DOMContentLoaded", async () => {
    try {
        console.log("Fetching cases from API...");
        const response = await fetch("/api/cases");
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Server error: ${errorData.error}${errorData.details ? ` - ${errorData.details}` : ''}`);
        }
        
    const data = await response.json();
        console.log("Received data:", data);
  
    const tableBody = document.querySelector("#pricesTable tbody");
        tableBody.innerHTML = ''; // Clear loading message
      
        if (!data || Object.keys(data).length === 0) {
            throw new Error("No case data received");
        }
  
        // Loop through the cases and insert rows into the table
        Object.entries(data).forEach(([caseName, caseData]) => {
      const row = document.createElement("tr");
  
      const caseCell = document.createElement("td");
      caseCell.textContent = caseName;
      row.appendChild(caseCell);
  
      const priceCell = document.createElement("td");
      priceCell.textContent = `$${caseData.price.toFixed(2)}`;
      row.appendChild(priceCell);
  
      const changeCell = document.createElement("td");
            changeCell.textContent = "N/A"; // We don't have historical data in the current format
      row.appendChild(changeCell);
  
      tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Failed to fetch case data:", error);
        const tableBody = document.querySelector("#pricesTable tbody");
        tableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; color: red;">
                    Error: ${error.message}<br>
                    Please check the console for more details.
                </td>
            </tr>
        `;
    }
  });
  