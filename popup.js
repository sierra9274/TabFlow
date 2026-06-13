import { getSettings, saveSettings, categorizeTab, DEFAULT_CATEGORIES } from "./rules.js";

// DOM Elements
const progressRing = document.getElementById("progressRing");
const tabCountEl = document.getElementById("tabCount");
const thresholdLabel = document.getElementById("thresholdLabel");
const gaugeStatusMsg = document.getElementById("gaugeStatusMsg");
const autoGroupToggle = document.getElementById("autoGroupToggle");
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdVal = document.getElementById("thresholdVal");
const categoriesList = document.getElementById("categoriesList");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const groupNowBtn = document.getElementById("groupNowBtn");
const ungroupAllBtn = document.getElementById("ungroupAllBtn");
const openOptionsLink = document.getElementById("openOptionsLink");

// Circular Progress Gauge Configuration
const radius = 50;
const circumference = 2 * Math.PI * radius;

// Set up SVG Progress Ring properties
if (progressRing) {
  progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
  progressRing.style.strokeDashoffset = circumference;
}

// Initial Load
document.addEventListener("DOMContentLoaded", async () => {
  const settings = await getSettings();
  
  // Sync inputs with settings
  autoGroupToggle.checked = settings.isEnabled;
  thresholdSlider.value = settings.tabThreshold;
  thresholdVal.textContent = `${settings.tabThreshold} tabs`;
  thresholdLabel.textContent = `/ ${settings.tabThreshold} tabs`;

  // Draw initial state
  await updateUIState(settings);

  // Setup Event Listeners
  autoGroupToggle.addEventListener("change", async () => {
    const freshSettings = await getSettings();
    freshSettings.isEnabled = autoGroupToggle.checked;
    await saveSettings(freshSettings);
    await updateUIState(freshSettings);
  });

  thresholdSlider.addEventListener("input", async () => {
    const val = thresholdSlider.value;
    thresholdVal.textContent = `${val} tabs`;
    thresholdLabel.textContent = `/ ${val} tabs`;
    
    const freshSettings = await getSettings();
    freshSettings.tabThreshold = parseInt(val);
    await saveSettings(freshSettings);
    await updateUIState(freshSettings);
  });

  groupNowBtn.addEventListener("click", () => {
    groupNowBtn.disabled = true;
    const originalText = groupNowBtn.innerHTML;
    groupNowBtn.innerHTML = "<span>Grouping...</span>";
    
    chrome.runtime.sendMessage({ action: "groupNow" }, async (response) => {
      groupNowBtn.disabled = false;
      groupNowBtn.innerHTML = originalText;
      const settings = await getSettings();
      await updateUIState(settings);
    });
  });

  ungroupAllBtn.addEventListener("click", () => {
    ungroupAllBtn.disabled = true;
    chrome.runtime.sendMessage({ action: "ungroupAll" }, async (response) => {
      ungroupAllBtn.disabled = false;
      const settings = await getSettings();
      await updateUIState(settings);
    });
  });

  openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});

// Update Dashboard View
async function updateUIState(settings) {
  try {
    // Get tabs in current active window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const totalTabs = tabs.length;
    
    // Update number display
    tabCountEl.textContent = totalTabs;

    // Update gauge percent and color indicator
    const threshold = settings.tabThreshold;
    const percent = Math.min(100, Math.floor((totalTabs / threshold) * 100));
    const offset = circumference - (percent / 100) * circumference;
    
    if (progressRing) {
      progressRing.style.strokeDashoffset = offset;
      
      // Update color based on load levels
      let stateColor = "var(--state-safe)";
      if (totalTabs >= threshold) {
        stateColor = "var(--state-danger)";
        statusDot.style.backgroundColor = "var(--state-danger)";
        statusDot.style.animationName = "pulse-dot-danger";
        statusText.textContent = "Cluttered";
        statusText.style.color = "var(--state-danger)";
        gaugeStatusMsg.textContent = "Overload! Grouping is active to declutter.";
        gaugeStatusMsg.style.color = "var(--state-danger)";
      } else if (totalTabs >= threshold - 2) {
        stateColor = "var(--state-warn)";
        statusDot.style.backgroundColor = "var(--state-warn)";
        statusDot.style.animationName = "pulse-dot-warn";
        statusText.textContent = "Warning";
        statusText.style.color = "var(--state-warn)";
        gaugeStatusMsg.textContent = "Getting crowded. Nearing trigger limit.";
        gaugeStatusMsg.style.color = "var(--state-warn)";
      } else {
        stateColor = "var(--state-safe)";
        statusDot.style.backgroundColor = "var(--state-safe)";
        statusDot.style.animationName = "pulse-dot";
        statusText.textContent = settings.isEnabled ? "Active" : "Disabled";
        statusText.style.color = "var(--text-muted)";
        gaugeStatusMsg.textContent = "Safe zone: Tab load is optimal.";
        gaugeStatusMsg.style.color = "var(--text-muted)";
      }
      
      progressRing.style.stroke = stateColor;
      progressRing.style.filter = `drop-shadow(0 0 6px ${stateColor})`;
    }

    // Classify tabs and count categories
    const categoriesCount = {};
    let whitelistedCount = 0;
    let uncategorizedCount = 0;

    for (const tab of tabs) {
      if (tab.pinned) continue;
      
      const category = categorizeTab(tab.url, tab.title, settings);
      if (category) {
        categoriesCount[category.name] = (categoriesCount[category.name] || 0) + 1;
      } else {
        // Check if whitelisted
        const isWhitelisted = (settings.whitelistedDomains || []).some(domain => {
          try {
            if (!tab.url) return false;
            const host = new URL(tab.url).hostname.toLowerCase();
            const cleanDomain = domain.trim().toLowerCase();
            return cleanDomain && (host === cleanDomain || host.endsWith("." + cleanDomain));
          } catch(e) { return false; }
        });
        if (isWhitelisted) {
          whitelistedCount++;
        } else {
          uncategorizedCount++;
        }
      }
    }

    // Render category list
    categoriesList.innerHTML = "";
    const mergedCategories = { ...DEFAULT_CATEGORIES, ...settings.customCategories };
    
    // Sort categories by tab counts (descending)
    const sortedCats = Object.entries(categoriesCount).sort((a, b) => b[1] - a[1]);
    
    if (sortedCats.length === 0 && uncategorizedCount === 0 && whitelistedCount === 0) {
      categoriesList.innerHTML = `<div class="empty-state">No open websites to group.</div>`;
      return;
    }

    // Render matched categories
    sortedCats.forEach(([catName, count]) => {
      const color = mergedCategories[catName]?.color || "grey";
      const hexColor = getCSSColorVar(color);
      
      const row = document.createElement("div");
      row.className = "category-row";
      row.innerHTML = `
        <div class="category-left">
          <span class="cat-dot" style="--dot-color: ${hexColor}; background-color: ${hexColor}"></span>
          <span class="cat-name">${catName}</span>
        </div>
        <span class="cat-badge">${count} tab${count > 1 ? "s" : ""}</span>
      `;
      categoriesList.appendChild(row);
    });

    // Render Whitelisted & Uncategorized entries if they exist
    if (whitelistedCount > 0) {
      const row = document.createElement("div");
      row.className = "category-row";
      row.style.opacity = "0.7";
      row.innerHTML = `
        <div class="category-left">
          <span class="cat-dot" style="--dot-color: #6b7280; background-color: #6b7280"></span>
          <span class="cat-name" style="color: var(--text-muted)">Whitelisted</span>
        </div>
        <span class="cat-badge">${whitelistedCount} tab${whitelistedCount > 1 ? "s" : ""}</span>
      `;
      categoriesList.appendChild(row);
    }

    if (uncategorizedCount > 0) {
      const row = document.createElement("div");
      row.className = "category-row";
      row.innerHTML = `
        <div class="category-left">
          <span class="cat-dot" style="--dot-color: #9ca3af; background-color: #9ca3af"></span>
          <span class="cat-name">General / Other</span>
        </div>
        <span class="cat-badge">${uncategorizedCount} tab${uncategorizedCount > 1 ? "s" : ""}</span>
      `;
      categoriesList.appendChild(row);
    }
  } catch (error) {
    console.error("Error refreshing popup metrics:", error);
    categoriesList.innerHTML = `<div class="empty-state" style="color: var(--state-danger)">Error loading metrics.</div>`;
  }
}

// Convert Chrome colors to CSS hex representation
function getCSSColorVar(colorName) {
  const colors = {
    grey: "#6b7280",
    blue: "#3b82f6",
    red: "#ef4444",
    yellow: "#eab308",
    green: "#10b981",
    pink: "#ec4899",
    purple: "#a855f7",
    cyan: "#06b6d4",
    orange: "#f97316"
  };
  return colors[colorName] || "#9ca3af";
}
