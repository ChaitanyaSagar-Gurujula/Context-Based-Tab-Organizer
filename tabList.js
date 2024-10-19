let allTabs = [];
let categories = new Set();

function initializeTabList() {
  const searchBar = document.getElementById('searchBar');
  const categoryFilter = document.getElementById('categoryFilter');

  searchBar.addEventListener('input', filterTabs);
  categoryFilter.addEventListener('change', filterTabs);

  loadTabs();
}

function loadTabs() {
  chrome.tabs.query({}, (tabs) => {
    chrome.storage.local.get('tabCategories', (result) => {
      const tabCategories = result.tabCategories || {};
      
      allTabs = tabs.map(tab => ({
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title,
        category: tabCategories[tab.id] || 'Uncategorized'
      }));

      categories = new Set(allTabs.map(tab => tab.category));

      updateCategoryFilter();
      filterTabs(); // Apply current filters instead of displaying all tabs
    });
  });
}

function updateCategoryFilter() {
  const categoryFilter = document.getElementById('categoryFilter');
  const currentSelection = categoryFilter.value;

  // Clear existing options
  categoryFilter.innerHTML = '<option value="">All Categories</option>';

  // Add sorted categories
  Array.from(categories).sort().forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });

  // Restore previous selection if it still exists
  if (Array.from(categoryFilter.options).some(option => option.value === currentSelection)) {
    categoryFilter.value = currentSelection;
  }
}

function displayTabs(tabs) {
  const tabList = document.getElementById('tabList');
  tabList.innerHTML = '';
  
  tabs.forEach(tab => {
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';
    tabItem.innerHTML = `
      <span class="category">[${tab.category}]</span>
      <span class="tab-title" data-tab-id="${tab.id}" data-window-id="${tab.windowId}">${tab.title}</span>
    `;
    
    const tabTitle = tabItem.querySelector('.tab-title');
    tabTitle.addEventListener('click', () => {
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        chrome.tabs.update(tab.id, { active: true });
      });
    });
    
    tabList.appendChild(tabItem);
  });
}

function filterTabs() {
  const searchTerm = document.getElementById('searchBar').value.toLowerCase();
  const selectedCategory = document.getElementById('categoryFilter').value;
  
  const filteredTabs = allTabs.filter(tab => {
    const matchesSearch = tab.title.toLowerCase().includes(searchTerm);
    const matchesCategory = selectedCategory === '' || tab.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });
  
  displayTabs(filteredTabs);
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateCategoryMapPopup") {
    loadTabs();
  }
});

document.addEventListener('DOMContentLoaded', initializeTabList);
