import { getSettings, categorizeTab } from "./rules.js";

// Helper to extract a friendly capitalized name from a URL hostname
function getDomainCategoryName(url) {
  try {
    const urlObj = new URL(url);
    let host = urlObj.hostname.toLowerCase();
    
    // Remove common prefixes
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }
    
    const parts = host.split(".");
    if (parts.length >= 2) {
      let mainPart = parts[parts.length - 2];
      // If it's a domain with a 2-character TLD structure, e.g. co.uk, com.au
      if (mainPart.length <= 3 && parts.length >= 3) {
        mainPart = parts[parts.length - 3];
      }
      return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
    }
    return "Web";
  } catch (e) {
    return "Web";
  }
}

// Select a Chrome tab color that is not currently in use, or cycle
function getUnusedColor(usedColors) {
  const allColors = ["blue", "cyan", "pink", "purple", "orange", "yellow", "red", "green"];
  const unused = allColors.filter(c => !usedColors.includes(c));
  if (unused.length > 0) {
    return unused[0];
  }
  return allColors[Math.floor(Math.random() * allColors.length)];
}

// Perform a batch API request to classify tabs using Gemini Flash
async function classifyTabsWithAI(tabsToClassify, apiKey) {
  if (!apiKey || tabsToClassify.length === 0) return [];

  // Get current categories from storage to guide the prompt
  const settings = await getSettings();
  const predefinedCategories = Object.keys(DEFAULT_CATEGORIES);
  const customCategories = Object.keys(settings.customCategories || {});
  const categoriesList = [...predefinedCategories, ...customCategories].join(", ");

  const prompt = `You are a tab classification assistant. Categorize these browser tabs into one of these existing categories: [${categoriesList}].
If a tab does not fit any of the existing categories, invent a new, concise category name (1 to 2 words, e.g., "Gaming", "Recipes", "Travel", "Banking") that represents the group.
Combine similar tabs into the same invented category where possible.

Return ONLY a JSON array of objects. Do not include markdown formatting, backticks, or any conversational text.
Response format:
[
  { "id": "tabId", "categoryName": "Category Name", "color": "blue/cyan/pink/red/yellow/purple/green/orange/grey" }
]

Available Chrome Group colors: ["blue", "cyan", "pink", "red", "yellow", "purple", "green", "orange", "grey"].
Assign colors harmoniously.

Tabs to classify:
${tabsToClassify.map(t => `- ID: ${t.id}, Title: "${t.title}", URL: "${t.url}"`).join("\n")}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API returned error status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error("No response candidates returned from Gemini");
    }

    const text = data.candidates[0].content.parts[0].text.trim();
    
    // Clean up potential markdown formatting if model didn't adhere strictly to JSON type
    let cleanedText = text;
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const classifications = JSON.parse(cleanedText);
    
    if (Array.isArray(classifications)) {
      return classifications.map(c => ({
        tabId: parseInt(c.id),
        categoryName: c.categoryName,
        color: c.color || "grey"
      }));
    }
    return [];
  } catch (error) {
    console.error("Failed AI tab classification:", error);
    return [];
  }
}


let debounceTimers = {};

// Debounce helper to prevent excessive grouping runs during bulk loading
function debounceGroup(windowId, manual = false) {
  if (!windowId) return;
  if (debounceTimers[windowId]) {
    clearTimeout(debounceTimers[windowId]);
  }
  
  debounceTimers[windowId] = setTimeout(async () => {
    delete debounceTimers[windowId];
    await runGroupingForWindow(windowId, manual);
  }, 600);
}

async function runGroupingForWindow(windowId, manual = false) {
  try {
    const settings = await getSettings();
    if (!settings.isEnabled && !manual) {
      return;
    }

    // Get all tabs in the window
    const tabs = await chrome.tabs.query({ windowId });
    if (!tabs || tabs.length === 0) return;

    // Filter out pinned tabs and system pages
    const groupableTabs = tabs.filter(tab => {
      if (tab.pinned) return false;
      if (!tab.url) return false;
      if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("edge://")) {
        return false;
      }
      return true;
    });

    const totalTabCount = tabs.length;
    
    // Check threshold (skip check if manual trigger)
    if (totalTabCount < settings.tabThreshold && !manual) {
      return;
    }

    // Find existing groups in the window
    const existingGroups = await chrome.tabGroups.query({ windowId });
    const groupMap = {}; // name -> groupId
    existingGroups.forEach(g => {
      if (g.title) {
        groupMap[g.title] = g.id;
      }
    });

    // First Pass: Categorize tabs using rules.js
    const tabCategories = []; // Array of tab info with category
    const categoryCounts = {}; // categoryName -> count
    const uncategorizedTabs = []; // List of tabs that didn't match pre-defined categories
    const usedColors = existingGroups.map(g => g.color).filter(Boolean);

    for (const tab of groupableTabs) {
      const cat = categorizeTab(tab.url, tab.title, settings);
      
      if (cat) {
        categoryCounts[cat.name] = (categoryCounts[cat.name] || 0) + 1;
        tabCategories.push({
          tabId: tab.id,
          url: tab.url,
          categoryName: cat.name,
          color: cat.color,
          currentGroupId: tab.groupId,
          active: tab.active
        });
        if (cat.color && !usedColors.includes(cat.color)) {
          usedColors.push(cat.color);
        }
      } else {
        uncategorizedTabs.push(tab);
      }
    }

    // AI Pass: If enabled and key is present, try classifying unmatched tabs using Gemini
    let aiSuccess = false;
    const stillUncategorized = [];

    if (settings.aiEnabled && settings.geminiApiKey && uncategorizedTabs.length > 0) {
      const tabsToClassify = uncategorizedTabs.map(t => ({
        id: t.id,
        title: t.title || "Untitled",
        url: t.url || ""
      }));

      const aiClassifications = await classifyTabsWithAI(tabsToClassify, settings.geminiApiKey);

      if (aiClassifications && aiClassifications.length > 0) {
        aiSuccess = true;
        for (const tab of uncategorizedTabs) {
          const aiResult = aiClassifications.find(c => c.tabId === tab.id);
          if (aiResult && aiResult.categoryName) {
            const catName = aiResult.categoryName.trim();
            const catColor = aiResult.color;
            
            categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;
            tabCategories.push({
              tabId: tab.id,
              url: tab.url,
              categoryName: catName,
              color: catColor,
              currentGroupId: tab.groupId,
              active: tab.active
            });
            if (catColor && !usedColors.includes(catColor)) {
              usedColors.push(catColor);
            }
          } else {
            stillUncategorized.push(tab);
          }
        }
      }
    }

    // Fallback: If AI categorization was disabled, was missing an API key, or encountered an error
    if (!aiSuccess) {
      const localUncategorized = [];
      if (settings.autoInventDomains && uncategorizedTabs.length > 0) {
        const domainGroups = {};
        for (const tab of uncategorizedTabs) {
          try {
            const host = new URL(tab.url).hostname.toLowerCase().replace("www.", "");
            if (!domainGroups[host]) {
              domainGroups[host] = [];
            }
            domainGroups[host].push(tab);
          } catch (e) {
            localUncategorized.push(tab);
          }
        }

        for (const [host, hostTabs] of Object.entries(domainGroups)) {
          const count = hostTabs.length;
          const shouldGroup = settings.groupSingletons || count >= 2;
          
          if (shouldGroup) {
            const catName = getDomainCategoryName(hostTabs[0].url);
            const catColor = getUnusedColor(usedColors);
            usedColors.push(catColor);
            
            categoryCounts[catName] = count;
            
            for (const tab of hostTabs) {
              tabCategories.push({
                tabId: tab.id,
                url: tab.url,
                categoryName: catName,
                color: catColor,
                currentGroupId: tab.groupId,
                active: tab.active
              });
            }
          } else {
            localUncategorized.push(...hostTabs);
          }
        }
      } else {
        localUncategorized.push(...uncategorizedTabs);
      }
      stillUncategorized.push(...localUncategorized);
    }

    // Third Pass: Bundle remaining miscellaneous singletons
    if (settings.bundleMisc && stillUncategorized.length > 0) {
      const count = stillUncategorized.length;
      const shouldGroup = settings.groupSingletons || count >= 2;
      
      if (shouldGroup) {
        const catName = "General";
        const catColor = "grey";
        
        categoryCounts[catName] = count;
        
        for (const tab of stillUncategorized) {
          tabCategories.push({
            tabId: tab.id,
            url: tab.url,
            categoryName: catName,
            color: catColor,
            currentGroupId: tab.groupId,
            active: tab.active
          });
        }
        stillUncategorized.length = 0; // Cleared
      }
    }

    // Determine grouping actions
    const tabsToGroup = {}; // categoryName -> array of tabIds
    const tabsToUngroup = [];

    // Map all processed assignments to tabsToGroup/tabsToUngroup
    const processedTabIds = tabCategories.map(t => t.tabId);
    
    // Add whitelisted or truly ungrouped tabs to tabsToUngroup
    groupableTabs.forEach(tab => {
      if (!processedTabIds.includes(tab.id)) {
        if (tab.groupId !== chrome.tabs.TAB_ID_NONE) {
          tabsToUngroup.push(tab.id);
        }
      }
    });

    for (const item of tabCategories) {
      const { tabId, categoryName, currentGroupId } = item;
      const count = categoryCounts[categoryName] || 0;
      const shouldGroup = settings.groupSingletons || count >= 2 || categoryName === "General";

      if (shouldGroup) {
        if (!tabsToGroup[categoryName]) {
          tabsToGroup[categoryName] = [];
        }
        tabsToGroup[categoryName].push(tabId);
      } else {
        if (currentGroupId !== chrome.tabs.TAB_ID_NONE) {
          tabsToUngroup.push(tabId);
        }
      }
    }

    // 1. Ungroup tabs that need ungrouping
    if (tabsToUngroup.length > 0) {
      try {
        await chrome.tabs.ungroup(tabsToUngroup);
      } catch (e) {
        console.warn("Error ungrouping tabs:", e);
      }
    }

    // 2. Group tabs by category
    for (const [catName, tabIds] of Object.entries(tabsToGroup)) {
      if (tabIds.length === 0) continue;
      
      try {
        let groupId = groupMap[catName];
        
        if (groupId) {
          // Add to existing group
          await chrome.tabs.group({ tabIds, groupId });
        } else {
          // Create new group
          groupId = await chrome.tabs.group({ tabIds });
          groupMap[catName] = groupId;
        }

        // Fetch category details to get the color
        const targetTab = tabCategories.find(t => t.categoryName === catName);
        const color = targetTab ? targetTab.color : "grey";

        // Update group title and color
        await chrome.tabGroups.update(groupId, {
          title: catName,
          color: color
        });
      } catch (e) {
        console.error(`Error grouping category ${catName}:`, e);
      }
    }

    // 3. Handle Auto-Collapse of inactive groups
    if (settings.collapseInactive) {
      const updatedGroups = await chrome.tabGroups.query({ windowId });
      const activeTab = tabs.find(t => t.active);
      const activeGroupId = activeTab ? activeTab.groupId : chrome.tabs.TAB_ID_NONE;

      for (const group of updatedGroups) {
        const shouldCollapse = group.id !== activeGroupId;
        try {
          await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse });
        } catch (e) {
          // Group might have been deleted/closed
        }
      }
    }
  } catch (error) {
    console.error("Error running grouping execution:", error);
  }
}

async function ungroupAllInWindow(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const tabIds = tabs
      .filter(tab => tab.groupId !== chrome.tabs.TAB_ID_NONE)
      .map(tab => tab.id);
    
    if (tabIds.length > 0) {
      await chrome.tabs.ungroup(tabIds);
    }
  } catch (e) {
    console.error("Error ungrouping all:", e);
  }
}

// Event Listeners
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.windowId) {
    debounceGroup(tab.windowId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Run grouping when url or title loads, or complete status reached
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    if (tab.windowId) {
      debounceGroup(tab.windowId);
    }
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // When switching tabs, check if we need to auto-collapse/expand groups
  try {
    const settings = await getSettings();
    if (settings.isEnabled && settings.collapseInactive && activeInfo.windowId) {
      const tabs = await chrome.tabs.query({ windowId: activeInfo.windowId });
      const activeTab = tabs.find(t => t.active);
      const activeGroupId = activeTab ? activeTab.groupId : chrome.tabs.TAB_ID_NONE;

      const groups = await chrome.tabGroups.query({ windowId: activeInfo.windowId });
      for (const group of groups) {
        const shouldCollapse = group.id !== activeGroupId;
        await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse });
      }
    }
  } catch (e) {
    console.warn("Error adjusting collapse state on activation:", e);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo.windowId && !removeInfo.isWindowClosing) {
    debounceGroup(removeInfo.windowId);
  }
});

// Runtime Messages from Popup and Options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "groupNow") {
    chrome.windows.getLastFocused({ populate: false }, (window) => {
      if (window && window.id) {
        runGroupingForWindow(window.id, true).then(() => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: "No active window found" });
      }
    });
    return true; // Keep channel open for async response
  } else if (message.action === "ungroupAll") {
    chrome.windows.getLastFocused({ populate: false }, (window) => {
      if (window && window.id) {
        ungroupAllInWindow(window.id).then(() => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: "No active window found" });
      }
    });
    return true;
  }
});
