// --- 1. DRAW THE FLOATING ON/OFF BUTTON ---
function injectUI() {
  // Create a small box
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.bottom = "20px";
  container.style.right = "20px";
  container.style.zIndex = "999999";
  container.style.backgroundColor = "white";
  container.style.border = "2px solid #107c41"; // Excel green border
  container.style.borderRadius = "8px";
  container.style.padding = "10px";
  container.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
  container.style.fontFamily = "sans-serif";
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.gap = "10px";

  const label = document.createElement("span");
  label.innerText = "Auto-Scraper:";
  label.style.fontWeight = "bold";
  label.style.fontSize = "14px";
  label.style.color = "#333";

  const btn = document.createElement("button");
  btn.style.padding = "6px 12px";
  btn.style.border = "none";
  btn.style.borderRadius = "4px";
  btn.style.fontWeight = "bold";
  btn.style.cursor = "pointer";

  // Update button colors based on state
  const updateBtn = (isActive) => {
    btn.innerText = isActive ? "ON" : "OFF";
    btn.style.backgroundColor = isActive ? "#107c41" : "#d13438"; // Green for ON, Red for OFF
    btn.style.color = "white";
  };

  // Load saved state from Chrome memory (default is ON)
  chrome.storage.local.get(["isScraperActive"], (result) => {
    let isActive = result.isScraperActive !== false; 
    updateBtn(isActive);

    // When clicked, flip the state and save it
    btn.onclick = () => {
      isActive = !isActive;
      updateBtn(isActive);
      chrome.storage.local.set({ isScraperActive: isActive });
    };
  });

  container.appendChild(label);
  container.appendChild(btn);
  document.body.appendChild(container);
}

// Run the UI function as soon as the page loads
injectUI();


// --- 2. THE SCRAPER LOGIC ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "SEARCH_BARCODE") {
    
    // Validate we are on the BillStatus page to prevent interfering with data entry on other pages
    const h1Elements = Array.from(document.querySelectorAll("h1"));
    const isBillStatusPage = h1Elements.some(h1 => h1.innerText.replace(/\s+/g, '').includes("BillStatus"));
    
    if (!isBillStatusPage) {
      console.log("Skipping scrape: Not on BillStatus page.");
      return;
    }

    const searchBox = document.getElementById("ctl00_ContentPlaceHolder1_txtbarcode"); 
    const searchBtn = document.getElementById("btnGetBills");
    
    if (searchBox) {
      searchBox.focus();
      searchBox.value = message.barcode;
      
      if (searchBtn) {
        searchBtn.click();
      } else {
        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      }
      
      // Wait for the search results to load
      setTimeout(() => {
        // Find and click the patient row (using DISPLAY_NAME column)
        const patientNameCell = document.querySelector('td[data-col="DISPLAY_NAME"]');
        if (patientNameCell) {
          // Click the cell and also its parent row to ensure the event fires
          patientNameCell.click();
          const parentRow = patientNameCell.closest('tr');
          if (parentRow) parentRow.click();
          console.log("Clicked patient row.");
        } else {
          console.log("Patient row not found.");
        }
        
        // Wait another moment for any row details to load after clicking
        setTimeout(() => {
          const patientNameElement = document.querySelector('td[data-col="DISPLAY_NAME"]');
          const patientName = patientNameElement ? patientNameElement.innerText.trim() : "Unknown Patient";
          
          // Grab ALL test names
          const testNameElements = document.querySelectorAll('td[data-col="SERVICE_NAME"]');
          const testNames = Array.from(testNameElements).map(el => el.innerText.trim());
          const finalTestName = testNames.length > 0 ? testNames.join(', ') : "Unknown Test";
          
          // Grab ALL test statuses
          const statusElements = document.querySelectorAll('td[data-col="SERVICE_STATUS"]');
          const statuses = Array.from(statusElements).map(el => el.innerText.trim());
          
          let finalStatus = "Sample Received";
          if (statuses.length > 0) {
            // Check if ALL tests are completed/approved
            const allCompleted = statuses.every(s => {
              const lower = s.toLowerCase();
              return lower.includes('approved') || lower.includes('completed') || lower.includes('verified');
            });
            
            if (allCompleted) {
              // If all tests share the same status (e.g. all "Approved"), show that status. Otherwise "Completed"
              finalStatus = (new Set(statuses).size === 1) ? statuses[0] : "Completed";
            } else {
              // Mix of statuses (e.g. "Approved / Pending")
              finalStatus = Array.from(new Set(statuses)).join(' / ');
            }
          }
          
          // Grab ALL service CDs
          const serviceCdElements = document.querySelectorAll('td[data-col="SERVICE_CD"]');
          const serviceCds = Array.from(serviceCdElements).map(el => el.innerText.trim());
          const finalServiceCd = serviceCds.length > 0 ? serviceCds.join(', ') : undefined;

          // Grab Sample Received Time
          const receivedElement = document.querySelector('td[data-col="SAMPLE_RECEVING_DT"]');
          const receivedTimeStr = receivedElement ? receivedElement.innerText.trim() : "";
          
          // Grab Result Time
          const resultElement = document.querySelector('td[data-col="RESULT_DATE"]');
          const resultTimeStr = resultElement ? resultElement.innerText.trim() : "";
          
          chrome.runtime.sendMessage({
            action: "UPDATE_STATUS",
            data: {
              barcode: message.barcode,
              patientName: patientName,
              testName: finalTestName,
              testDetails: JSON.stringify(testNames.map((name, i) => ({ name, status: statuses[i] || 'Unknown' }))),
              serviceCd: finalServiceCd,
              status: finalStatus,
              receivedTime: receivedTimeStr,
              resultTime: resultTimeStr
            }
          });
        }, 5000); 
      }, 4000); 
    } else {
      console.log("LIS search input not found on this page.");
    }
  }
});