import { getSettings, categorizeTab } from "./rules.js";

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

    // Categorize tabs
    const tabCategories = []; // Array of tab info with category
    const categoryCounts = {}; // categoryName -> count

    for (const tab of groupableTabs) {
      const cat = categorizeTab(tab.url, tab.title, settings);
      const catName = cat ? cat.name : null;
      const catColor = cat ? cat.color : null;
      
      if (catName) {
        categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;
      }
      
      tabCategories.push({
        tabId: tab.id,
        categoryName: catName,
        color: catColor,
        currentGroupId: tab.groupId,
        active: tab.active
      });
    }

    // Determine grouping actions
    const tabsToGroup = {}; // categoryName -> array of tabIds
    const tabsToUngroup = [];

    for (const item of tabCategories) {
      const { tabId, categoryName, currentGroupId } = item;
      
      if (!categoryName) {
        // No category, should ungroup if currently grouped
        if (currentGroupId !== chrome.tabs.TAB_ID_NONE) {
          tabsToUngroup.push(tabId);
        }
        continue;
      }

      const count = categoryCounts[categoryName] || 0;
      const shouldGroup = settings.groupSingletons || count >= 2;

      if (shouldGroup) {
        if (!tabsToGroup[categoryName]) {
          tabsToGroup[categoryName] = [];
        }
        tabsToGroup[categoryName].push(tabId);
      } else {
        // If it shouldn't be grouped but is currently in a group, ungroup it
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
