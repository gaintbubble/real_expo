// --- 1. DRAW THE FLOATING ON/OFF BUTTON (Only on LIS / external pages) ---
function injectUI() {
  // Only inject floating button if not on localhost dashboard to keep dashboard clean
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return;
  }

  // Check if already injected
  if (document.getElementById("lis-scraper-widget")) return;

  const container = document.createElement("div");
  container.id = "lis-scraper-widget";
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

  const updateBtn = (isActive) => {
    btn.innerText = isActive ? "ON" : "OFF";
    btn.style.backgroundColor = isActive ? "#107c41" : "#d13438";
    btn.style.color = "white";
  };

  chrome.storage.local.get(["isScraperActive"], (result) => {
    let isActive = result.isScraperActive !== false; 
    updateBtn(isActive);

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

// Run UI injection if document body is available
if (document.body) {
  injectUI();
} else {
  window.addEventListener('DOMContentLoaded', injectUI);
}


// --- 2. DASHBOARD BRIDGE: RECEIVE TRIGGER LOOKUP REQUESTS FROM DASHBOARD ---
function handleDashboardTriggerRequest(payload) {
  if (!payload || !payload.barcode) return;
  const barcode = String(payload.barcode).trim();
  if (!barcode) return;

  // Diagnostic logs specified in requirements:
  console.log('[Extension Content Script] Event received for barcode:', barcode);
  console.log(`[Extension] Received lookup request for barcode: ${barcode}. Querying LIS...`);

  // Immediate acknowledgment back to dashboard window
  try {
    window.postMessage({ type: 'EXTENSION_ACK', barcode: barcode }, '*');
    window.dispatchEvent(new CustomEvent('EXTENSION_ACK', { detail: { barcode: barcode } }));
  } catch (e) {}

  // Relay lookup request to background service worker
  try {
    chrome.runtime.sendMessage({
      action: "SEARCH_BARCODE",
      barcode: barcode,
      departmentId: payload.departmentId || "HAEMATOLOGY",
      departmentTriggerTime: payload.departmentTriggerTime ?? 0,
      timestamp: payload.timestamp || new Date().toISOString(),
      dashboardUrl: window.location.origin
    }).catch((err) => {
      console.warn("[Extension] Could not relay lookup to background worker:", err);
    });
  } catch (err) {
    console.warn("[Extension] Context invalid or extension disconnected:", err);
  }
}

// Listen for window.postMessage events dispatched from the dashboard
window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  const t = event.data.type || event.data.action;
  if (
    t === "CHECK_BARCODE_DATA" || 
    t === "LIS_TAT_TRIGGER_CHECK" || 
    t === "SEARCH_BARCODE"
  ) {
    handleDashboardTriggerRequest(event.data);
  }
});

// Listen for custom DOM events dispatched from the dashboard
window.addEventListener("CHECK_BARCODE_DATA", (event) => {
  if (event && event.detail) {
    handleDashboardTriggerRequest(event.detail);
  }
});

window.addEventListener("LIS_TAT_TRIGGER_CHECK", (event) => {
  if (event && event.detail) {
    handleDashboardTriggerRequest(event.detail);
  }
});

// Notify background worker of the active dashboard URL (only from dashboard origins, not external LIS pages)
if (typeof window !== "undefined" && window.location && window.location.origin) {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === 'real-expo.vercel.app' || document.querySelector('.dashboard-container')) {
    try {
      chrome.runtime.sendMessage({
        action: "SET_DASHBOARD_URL",
        url: window.location.origin
      }).catch(() => {});
    } catch (e) {}
  }
}


// --- 3. LIS SCRAPER LOGIC & RELAY BACK TO DASHBOARD ---
chrome.runtime.onMessage.addListener((message) => {
  // Relay status updates back to dashboard window so dashboard can re-fetch immediately
  if (message.action === "LIS_STATUS_UPDATED" && message.data) {
    window.postMessage({ type: "LIS_STATUS_UPDATED", data: message.data }, "*");
    window.dispatchEvent(new CustomEvent("LIS_STATUS_UPDATED", { detail: message.data }));
    return;
  }

  if (message.action === "SEARCH_BARCODE" || message.action === "CHECK_BARCODE_DATA") {
    console.log(`[Extension] Received lookup request for barcode: ${message.barcode}. Querying LIS...`);

    // Detect LIS search page by search input OR BillStatus in heading/URL
    const searchBox = document.getElementById("ctl00_ContentPlaceHolder1_txtbarcode") || document.querySelector("input[name*='barcode' i], input[id*='barcode' i]"); 
    const searchBtn = document.getElementById("btnGetBills") || document.querySelector("input[value*='Get Bills' i], button[id*='GetBills' i]");
    const isBillStatusUrl = window.location.href.toLowerCase().includes("billstatus");
    const h1Elements = Array.from(document.querySelectorAll("h1, h2, h3, .title, span"));
    const isBillStatusHeading = h1Elements.some(el => (el.innerText || '').toLowerCase().includes("billstatus") || (el.innerText || '').toLowerCase().includes("bill status"));
    const isBillStatusPage = Boolean(searchBox || isBillStatusUrl || isBillStatusHeading);

    if (!isBillStatusPage && !searchBox) {
      // If we are not on BillStatus page, do not attempt DOM interaction
      return;
    }

    if (searchBox) {
      searchBox.focus();
      searchBox.value = message.barcode;

      if (searchBtn) {
        searchBtn.click();
      } else {
        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      }

      // Poll for search results to load promptly rather than waiting blind 4000ms
      const searchStartTime = Date.now();
      const pollForResults = () => {
        const patientNameCell = document.querySelector('td[data-col="DISPLAY_NAME"]');
        if (patientNameCell) {
          patientNameCell.click();
          const parentRow = patientNameCell.closest('tr');
          if (parentRow) parentRow.click();
          console.log("[Extension] Clicked patient row for barcode:", message.barcode);

          // Poll for row details to appear in DOM
          const detailStartTime = Date.now();
          const pollForDetails = () => {
            const testNameElements = document.querySelectorAll('td[data-col="SERVICE_NAME"]');
            const statusElements = document.querySelectorAll('td[data-col="SERVICE_STATUS"]');
            const hasDetails = testNameElements.length > 0 && statusElements.length > 0;
            const elapsedDetails = Date.now() - detailStartTime;

            if (hasDetails || elapsedDetails >= 2500) {
              const patientNameElement = document.querySelector('td[data-col="DISPLAY_NAME"]');
              const patientName = patientNameElement ? patientNameElement.innerText.trim() : "--";

              // Grab ALL test names
              const testNames = Array.from(testNameElements).map(el => el.innerText.trim()).filter(Boolean);
              const finalTestName = testNames.length > 0 ? testNames.join(', ') : "Not Found";

              // Grab ALL test statuses
              const statuses = Array.from(statusElements).map(el => el.innerText.trim());

              let finalStatus = "Sample Received";
              if (statuses.length === 0 || testNames.length === 0) {
                finalStatus = "Check Failed";
              } else {
                // Check if any tests are uncollected or collected
                const hasCollectedOnly = statuses.some(s => {
                  const lower = s.toLowerCase();
                  return lower.includes('collected') || lower.includes('batch');
                }) && !statuses.some(s => s.toLowerCase().includes('received') || s.toLowerCase().includes('done'));

                if (hasCollectedOnly) {
                  finalStatus = "Sample Collected";
                } else {
                  const allCompleted = statuses.every(s => {
                    const lower = s.toLowerCase();
                    return lower.includes('approved') || lower.includes('completed') || lower.includes('verified');
                  });

                  if (allCompleted) {
                    finalStatus = (new Set(statuses).size === 1) ? statuses[0] : "Completed";
                  } else {
                    finalStatus = Array.from(new Set(statuses)).join(' / ');
                  }
                }
              }

              // Grab ALL service CDs
              const serviceCdElements = document.querySelectorAll('td[data-col="SERVICE_CD"]');
              const serviceCds = Array.from(serviceCdElements).map(el => el.innerText.trim()).filter(Boolean);
              const finalServiceCd = serviceCds.length > 0 ? serviceCds.join(', ') : undefined;

              // Grab Sample Received Time
              const receivedElements = Array.from(document.querySelectorAll('td[data-col="SAMPLE_RECEVING_DT"]'));
              const validReceived = receivedElements.map(el => el.innerText.trim()).filter(t => t && t !== '--' && t !== '-');
              const receivedTimeStr = validReceived.length > 0 ? validReceived[0] : "";

              // Grab Result Time
              const resultElements = Array.from(document.querySelectorAll('td[data-col="RESULT_DATE"], td[data-col="VERIFIED_DATE"], td[data-col="APPROVED_DATE"]'));
              const validResults = resultElements.map(el => el.innerText.trim()).filter(t => t && t !== '--' && t !== '-');
              const resultTimeStr = validResults.length > 0 ? validResults[validResults.length - 1] : "";

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
            } else {
              setTimeout(pollForDetails, 250);
            }
          };

          setTimeout(pollForDetails, 300);
        } else if (Date.now() - searchStartTime >= 3000) {
          console.log("[Extension] Patient row not found for barcode:", message.barcode);
          // Barcode not found in LIS! Report Check Failed with 'Not Found'
          chrome.runtime.sendMessage({
            action: "UPDATE_STATUS",
            data: {
              barcode: message.barcode,
              patientName: "--",
              testName: "Not Found",
              testDetails: JSON.stringify([]),
              serviceCd: undefined,
              status: "Check Failed",
              receivedTime: "",
              resultTime: ""
            }
          });
        } else {
          setTimeout(pollForResults, 250);
        }
      };

      setTimeout(pollForResults, 300); 
    } else {
      console.log("[Extension] LIS search input not found on this page.");
    }
  }
});