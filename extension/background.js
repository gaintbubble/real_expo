const API_URL = "http://localhost:3000/api/extension";

console.log("🚀 Background Scraper Started!");

// Check for pending barcodes every 5 seconds
setInterval(() => {
  chrome.storage.local.get(["isScraperActive"], async (result) => {
    
    if (result.isScraperActive === false) {
      console.log("⏸️ Scraper is OFF. Skipping check.");
      return;
    }

    console.log("🔍 Scraper is ON. Checking database for pending barcodes...");

    try {
      const response = await fetch(`${API_URL}/get-pending`);
      const data = await response.json();

      if (!data.success) {
        console.log("❌ Database returned an error.");
        return;
      }

      if (data.samples.length === 0) {
        console.log("✅ Database connected, but NO pending barcodes found.");
        return;
      }

      const sample = data.samples[0]; 
      console.log("🎯 Found pending barcode in DB:", sample.barcode);

      // Tell the LIS page to search by broadcasting to all open tabs
      chrome.tabs.query({}, function(tabs) {
        console.log("💉 Broadcasting barcode to all tabs to find the LIS...");
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { 
              action: "SEARCH_BARCODE", 
              barcode: sample.barcode 
            }).catch(() => {
              // Ignore errors for tabs that don't have the content script injected
            });
          }
        });
      });

    } catch (error) {
      // ESLint Fix: The error variable is now printed to the console
      console.log("🔌 Cannot connect to Dashboard (Is localhost:3000 running?)", error);
    }
  });
}, 10000);

// Listen for the scraped results from the LIS page
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "UPDATE_STATUS") {
    console.log("📤 Received data from LIS! Sending to Database:", message.data);
    
    fetch(`${API_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.data)
    }).then(() => console.log("💾 Successfully updated database!"));
  }
});