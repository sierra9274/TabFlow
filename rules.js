export const DEFAULT_CATEGORIES = {
  "Development": {
    "color": "blue",
    "keywords": ["github.com", "stackoverflow.com", "localhost", "127.0.0.1", "gitlab.com", "codepen.io", "stackblitz.com", "npmjs.com", "gemini.google.com", "claude.ai", "chatgpt.com", "developer.mozilla.org", "mdn", "w3schools.com"]
  },
  "Work & Docs": {
    "color": "cyan",
    "keywords": ["docs.google.com", "drive.google.com", "sheets.google.com", "notion.so", "slack.com", "trello.com", "jira.com", "meet.google.com", "zoom.us", "figma.com", "teams.microsoft.com", "outlook", "office.com"]
  },
  "Social & Chat": {
    "color": "pink",
    "keywords": ["facebook.com", "twitter.com", "x.com", "reddit.com", "instagram.com", "linkedin.com", "whatsapp.com", "discord.com", "telegram.org"]
  },
  "Entertainment": {
    "color": "red",
    "keywords": ["youtube.com", "netflix.com", "spotify.com", "twitch.tv", "primevideo.com", "vimeo.com", "hulu.com", "disneyplus.com"]
  },
  "Shopping & Finance": {
    "color": "yellow",
    "keywords": ["amazon.com", "ebay.com", "etsy.com", "walmart.com", "stripe.com", "paypal.com", "target.com", "shopify.com", "robinhood.com"]
  },
  "News & Info": {
    "color": "purple",
    "keywords": ["wikipedia.org", "nytimes.com", "cnn.com", "bbc.com", "news.ycombinator.com", "medium.com", "bloomberg.com"]
  }
};

export const CHROME_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      isEnabled: true,
      tabThreshold: 8,
      groupSingletons: false, // If false, only groups when there are >= 2 tabs in a category
      customCategories: {}, // User defined overrides/new categories
      whitelistedDomains: [], // Domains that should never be grouped
      collapseInactive: true, // Collapse groups when not focused
      autoInventDomains: true, // Auto-invent categories for domains with >= 2 tabs
      bundleMisc: true // Consolidate remaining ungrouped tabs into a General group
    }, (settings) => {
      resolve(settings);
    });
  });
}

export async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, () => {
      resolve();
    });
  });
}

export function categorizeTab(url, title, settings) {
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.toLowerCase();
    const href = url.toLowerCase();
    const pageTitle = (title || "").toLowerCase();
    
    // Check whitelist
    const whitelisted = (settings.whitelistedDomains || []).some(domain => {
      const cleanDomain = domain.trim().toLowerCase();
      return cleanDomain && (host === cleanDomain || host.endsWith("." + cleanDomain));
    });
    if (whitelisted) {
      return null;
    }

    // Merge default and custom categories
    const categories = { ...DEFAULT_CATEGORIES, ...(settings.customCategories || {}) };
    
    // Check custom and default rules
    for (const [catName, catData] of Object.entries(categories)) {
      const keywords = catData.keywords || [];
      for (const kw of keywords) {
        const cleanKw = kw.toLowerCase().trim();
        if (!cleanKw) continue;
        
        if (host.includes(cleanKw) || href.includes(cleanKw) || pageTitle.includes(cleanKw)) {
          return { name: catName, color: catData.color };
        }
      }
    }
  } catch (e) {
    console.error("Error categorizing tab:", e);
  }
  
  return null;
}
