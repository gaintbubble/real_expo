let API_URL = "http://localhost:3000/api/extension";

// Check if we have a saved API URL or storage override
chrome.storage.local.get(["dashboardUrl"], (result) => {
  if (result.dashboardUrl) {
    API_URL = `${result.dashboardUrl}/api/extension`;
  }
});

console.log("🚀 Background Scraper Started!");

// Listen for messages from content scripts and dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SET_DASHBOARD_URL" && message.url) {
    API_URL = `${message.url}/api/extension`;
    chrome.storage.local.set({ dashboardUrl: message.url });
    return;
  }

  // Handle lookup trigger request from dashboard or content script
  if (message.action === "SEARCH_BARCODE" || message.action === "TRIGGER_BARCODE_CHECK") {
    // Diagnostic log specified in requirements:
    console.log(`[Extension] Received lookup request for barcode: ${message.barcode}. Querying LIS...`);

    // Broadcast SEARCH_BARCODE to all open tabs so the LIS tab searches
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { 
            action: "SEARCH_BARCODE", 
            barcode: message.barcode 
          }).catch(() => {
            // Ignore error if tab does not have content script injected
          });
        }
      });
    });

    if (sendResponse) sendResponse({ success: true, barcode: message.barcode });
    return true;
  }

  // Listen for the scraped results from the LIS page
  if (message.action === "UPDATE_STATUS") {
    console.log("📤 Received data from LIS! Sending to Database:", message.data);

    fetch(`${API_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.data)
    })
      .then(res => res.json())
      .then(result => {
        console.log("💾 Successfully updated database:", result);
        // Relay update back to all tabs so dashboard re-fetches immediately
        chrome.tabs.query({}, function(tabs) {
          tabs.forEach(tab => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, {
                action: "LIS_STATUS_UPDATED",
                data: message.data
              }).catch(() => {});
            }
          });
        });
      })
      .catch((error) => {
        console.warn("❌ Could not connect to API at " + API_URL + ", trying fallback...", error);
        // Fallback to production if local fails
        const fallbackUrl = "https://real-expo.vercel.app/api/extension/update-status";
        fetch(fallbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.data)
        }).catch(e => console.error("Database update completely failed:", e));
      });
  }
});

// Periodic fallback poll: Check for pending barcodes every 10 seconds
setInterval(() => {
  chrome.storage.local.get(["isScraperActive"], async (result) => {
    if (result.isScraperActive === false) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/get-pending`);
      const data = await response.json();

      if (!data.success || !data.samples || data.samples.length === 0) {
        return;
      }

      const sample = data.samples[0]; 
      console.log(`[Extension] Received lookup request for barcode: ${sample.barcode}. Querying LIS...`);

      // Tell the LIS page to search by broadcasting to all open tabs
      chrome.tabs.query({}, function(tabs) {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { 
              action: "SEARCH_BARCODE", 
              barcode: sample.barcode 
            }).catch(() => {});
          }
        });
      });
    } catch (error) {
      // Ignore background network failure silently
    }
  });
}, 10000);