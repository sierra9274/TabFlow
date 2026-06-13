import { getSettings, saveSettings, DEFAULT_CATEGORIES, CHROME_COLORS } from "./rules.js";

// State Tracker
let activeTab = "rules-tab";
let selectedColor = "grey";

// DOM Elements
const navItems = document.querySelectorAll(".nav-item");
const tabContents = document.querySelectorAll(".tab-content");
const toast = document.getElementById("toast");

// Rules DOM
const rulesGrid = document.getElementById("rulesGrid");
const addCategoryBtn = document.getElementById("addCategoryBtn");
const categoryModal = document.getElementById("categoryModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const cancelModalBtn = document.getElementById("cancelModalBtn");
const saveCategoryBtn = document.getElementById("saveCategoryBtn");
const catNameInput = document.getElementById("catNameInput");
const catKeywordsInput = document.getElementById("catKeywordsInput");
const colorPickerGrid = document.getElementById("colorPickerGrid");

// Settings DOM
const thresholdNumber = document.getElementById("thresholdNumber");
const collapseToggle = document.getElementById("collapseToggle");
const singletonsToggle = document.getElementById("singletonsToggle");
const whitelistTextarea = document.getElementById("whitelistTextarea");
const saveWhitelistBtn = document.getElementById("saveWhitelistBtn");

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Navigation Event Listeners
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetTab = item.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });

  // 2. Load settings and initialize UIs
  const settings = await getSettings();
  initSettingsTab(settings);
  initRulesTab(settings);
  initColorPicker();

  // Modal handlers
  addCategoryBtn.addEventListener("click", () => {
    openModal();
  });

  [closeModalBtn, cancelModalBtn].forEach(btn => {
    btn.addEventListener("click", () => {
      closeModal();
    });
  });

  saveCategoryBtn.addEventListener("click", async () => {
    await saveNewCategory();
  });
});

// Toast Utility
function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2500);
}

// Switch Sidebar Tabs
function switchTab(tabId) {
  navItems.forEach(item => {
    if (item.getAttribute("data-tab") === tabId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  tabContents.forEach(content => {
    if (content.id === tabId) {
      content.classList.add("active");
    } else {
      content.classList.remove("active");
    }
  });

  activeTab = tabId;
}

/* ==========================================================================
   Tab 1: Rules Manager & Custom Categories
   ========================================================================== */

function initRulesTab(settings) {
  renderRules(settings);
}

function renderRules(settings) {
  rulesGrid.innerHTML = "";
  const customCats = settings.customCategories || {};
  
  // Merge categories for representation
  const allCategories = { ...DEFAULT_CATEGORIES, ...customCats };

  Object.entries(allCategories).forEach(([catName, catData]) => {
    const isSystem = catName in DEFAULT_CATEGORIES;
    const hexColor = getCSSColorHex(catData.color);

    const card = document.createElement("div");
    card.className = "rule-card glass-card";
    
    // Header
    const cardHeader = document.createElement("div");
    cardHeader.className = "rule-card-header";
    
    const cardTitle = document.createElement("div");
    cardTitle.className = "rule-card-title";
    cardTitle.innerHTML = `
      <span class="color-dot" style="background-color: ${hexColor}"></span>
      <h3>${catName}</h3>
      ${isSystem ? '<span class="badge-system">System</span>' : ""}
    `;
    cardHeader.appendChild(cardTitle);

    if (!isSystem) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-delete-cat";
      deleteBtn.title = "Delete Category";
      deleteBtn.innerHTML = "&times;";
      deleteBtn.addEventListener("click", () => deleteCategory(catName));
      cardHeader.appendChild(deleteBtn);
    }
    card.appendChild(cardHeader);

    // Body (Chips & Form)
    const cardBody = document.createElement("div");
    cardBody.className = "rule-card-body";

    // Chips container
    const chipsContainer = document.createElement("div");
    chipsContainer.className = "chips-container";
    
    const keywords = catData.keywords || [];
    if (keywords.length === 0) {
      chipsContainer.innerHTML = `<span class="empty-chips">No matching keywords. Add one below.</span>`;
    } else {
      keywords.forEach((kw, index) => {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `
          <span>${kw}</span>
          <button class="btn-remove-chip" data-index="${index}">&times;</button>
        `;
        // Chip deletion
        chip.querySelector(".btn-remove-chip").addEventListener("click", () => {
          removeKeyword(catName, index, isSystem);
        });
        chipsContainer.appendChild(chip);
      });
    }
    cardBody.appendChild(chipsContainer);

    // Add Keyword Form
    const addForm = document.createElement("div");
    addForm.className = "add-chip-form";
    
    const input = document.createElement("input");
    input.type = "text";
    input.className = "input-keyword";
    input.placeholder = "Add domain / keyword...";
    
    const addBtn = document.createElement("button");
    addBtn.className = "btn-add-keyword";
    addBtn.textContent = "Add";

    // Bind add actions
    const triggerAdd = () => {
      const value = input.value.trim().toLowerCase();
      if (value) {
        addKeyword(catName, value, isSystem);
      }
    };
    
    addBtn.addEventListener("click", triggerAdd);
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") triggerAdd();
    });

    addForm.appendChild(input);
    addForm.appendChild(addBtn);
    cardBody.appendChild(addForm);

    card.appendChild(cardBody);
    rulesGrid.appendChild(card);
  });
}

// Action: Add Keyword
async function addKeyword(categoryName, keyword, isSystem) {
  const settings = await getSettings();
  
  if (isSystem) {
    // Modify system rule by copying into customCategories overrides
    if (!settings.customCategories[categoryName]) {
      settings.customCategories[categoryName] = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES[categoryName]));
    }
    if (!settings.customCategories[categoryName].keywords.includes(keyword)) {
      settings.customCategories[categoryName].keywords.push(keyword);
    }
  } else {
    // Custom category
    if (!settings.customCategories[categoryName].keywords.includes(keyword)) {
      settings.customCategories[categoryName].keywords.push(keyword);
    }
  }

  await saveSettings(settings);
  renderRules(settings);
  showToast(`Added "${keyword}" to ${categoryName}`);
}

// Action: Remove Keyword
async function removeKeyword(categoryName, index, isSystem) {
  const settings = await getSettings();

  if (isSystem) {
    // Create override copy if not existing
    if (!settings.customCategories[categoryName]) {
      settings.customCategories[categoryName] = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES[categoryName]));
    }
    settings.customCategories[categoryName].keywords.splice(index, 1);
  } else {
    // Custom category
    settings.customCategories[categoryName].keywords.splice(index, 1);
  }

  await saveSettings(settings);
  renderRules(settings);
  showToast(`Keyword removed from ${categoryName}`);
}

// Action: Delete Custom Category
async function deleteCategory(categoryName) {
  if (confirm(`Are you sure you want to delete the custom category "${categoryName}"?`)) {
    const settings = await getSettings();
    delete settings.customCategories[categoryName];
    await saveSettings(settings);
    renderRules(settings);
    showToast(`Deleted category "${categoryName}"`);
  }
}

// Initialized Color grid inside Create modal
function initColorPicker() {
  colorPickerGrid.innerHTML = "";
  CHROME_COLORS.forEach(color => {
    const opt = document.createElement("div");
    opt.className = `color-option ${color === selectedColor ? "selected" : ""}`;
    opt.style.backgroundColor = getCSSColorHex(color);
    opt.setAttribute("data-color", color);
    
    opt.addEventListener("click", () => {
      document.querySelectorAll(".color-option").forEach(el => el.classList.remove("selected"));
      opt.classList.add("selected");
      selectedColor = color;
    });

    colorPickerGrid.appendChild(opt);
  });
}

// Save New Custom Category
async function saveNewCategory() {
  const name = catNameInput.value.trim();
  const kwString = catKeywordsInput.value.trim();
  
  if (!name) {
    alert("Please enter a category name.");
    return;
  }

  const settings = await getSettings();
  
  // Check validation
  if (name in DEFAULT_CATEGORIES || name in settings.customCategories) {
    alert("A category with this name already exists.");
    return;
  }

  // Parse keywords
  const keywords = kwString
    ? kwString.split(",").map(k => k.trim().toLowerCase()).filter(k => k.length > 0)
    : [];

  // Initialize
  settings.customCategories[name] = {
    color: selectedColor,
    keywords: keywords
  };

  await saveSettings(settings);
  closeModal();
  renderRules(settings);
  showToast(`Created category "${name}"`);
}

// Modal Toggle Elements
function openModal() {
  selectedColor = "grey";
  catNameInput.value = "";
  catKeywordsInput.value = "";
  initColorPicker();
  categoryModal.classList.remove("hidden");
}

function closeModal() {
  categoryModal.classList.add("hidden");
}

/* ==========================================================================
   Tab 2: General Settings Configuration
   ========================================================================== */

function initSettingsTab(settings) {
  // Threshold value
  thresholdNumber.value = settings.tabThreshold;
  thresholdNumber.addEventListener("change", async () => {
    const freshSettings = await getSettings();
    freshSettings.tabThreshold = Math.max(3, parseInt(thresholdNumber.value) || 8);
    await saveSettings(freshSettings);
    showToast("Trigger limit updated");
  });

  // Collapse toggle
  collapseToggle.checked = settings.collapseInactive;
  collapseToggle.addEventListener("change", async () => {
    const freshSettings = await getSettings();
    freshSettings.collapseInactive = collapseToggle.checked;
    await saveSettings(freshSettings);
    showToast(`Auto-collapse ${collapseToggle.checked ? "enabled" : "disabled"}`);
  });

  // Singletons toggle
  singletonsToggle.checked = settings.groupSingletons;
  singletonsToggle.addEventListener("change", async () => {
    const freshSettings = await getSettings();
    freshSettings.groupSingletons = singletonsToggle.checked;
    await saveSettings(freshSettings);
    showToast(`Singleton grouping ${singletonsToggle.checked ? "enabled" : "disabled"}`);
  });

  // Whitelist domains
  whitelistTextarea.value = (settings.whitelistedDomains || []).join("\n");
  saveWhitelistBtn.addEventListener("click", async () => {
    const content = whitelistTextarea.value;
    const list = content
      .split("\n")
      .map(line => line.trim().toLowerCase())
      .filter(line => line.length > 0);
    
    const freshSettings = await getSettings();
    freshSettings.whitelistedDomains = list;
    await saveSettings(freshSettings);
    showToast("Whitelist domains saved");
  });
}

/* ==========================================================================
   CSS Color Converters
   ========================================================================== */

function getCSSColorHex(colorName) {
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
  return colors[colorName] || "#6b7280";
}
