// Store your Cohere API key 
const COHERE_API_KEY = '<enter_your_coher_api_key_here>';


// Modify the listeners
chrome.tabs.onCreated.addListener((tab) => {
  // Don't handle the tab immediately on creation
  console.log(`New tab created: ${tab.id}`);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && !tab.url.startsWith('chrome://')) {
    handleNewTab(tab);
  }
});
// Add a listener to clean up stored categories when tabs are removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabCategories = await getTabCategories();
  if (tabCategories[tabId]) {
    delete tabCategories[tabId];
    await setTabCategories(tabCategories);
  }
});
// Also, add this to log when the background script is loaded
console.log('Background script loaded at:', new Date().toISOString());


// Initialize the extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Context-Based Tab Organizer installed');
  setupCacheCleaning();
  // Remove existing menu items to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    createContextMenu();
  });

  // Categorize all existing tabs
  const windows = await chrome.windows.getAll({ populate: true });
  for (const window of windows) {
    for (const tab of window.tabs) {
      await categorizeAndCacheTab(tab);
    }
  }
});

// Keep the background script alive
chrome.runtime.onSuspend.addListener(() => {
  console.log('Background script is being suspended');
});

chrome.runtime.onSuspendCanceled.addListener(() => {
  console.log('Suspension of background script canceled');
});

// Function to get page content
async function getPageContent(tabId) {
  console.log(`Attempting to get page content for tab ${tabId}`);
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: () => {
        return document.body.innerText;
      },
    });
    console.log(`Successfully retrieved content for tab ${tabId}, length: ${result.result.length}`);
    return result.result;
  } catch (error) {
    console.error(`Error getting page content for tab ${tabId}:`, error);
    return '';
  }
}

const BATCH_SIZE = 20; // Default batch size, can be adjusted based on rate limits

// Function to categorize a single tab using Cohere's API
async function categorizeTab(tab) {
  console.log(`Categorizing tab ${tab.id} with URL: ${tab.url}`);
  
  // Check if we already have a cached category for this URL
  const cachedCategory = await getCachedCategory(tab.url);
  if (cachedCategory) {
    console.log(`Using cached category for ${tab.url}: ${cachedCategory}`);
    return cachedCategory;
  }

  // If not cached, proceed with API call
  try {
    console.log(`Calling LLM for tab ${tab.id}`);
    //const contentPromise = getPageContent(tab.id);
    //const timeoutPromise = new Promise((_, reject) => 
    //  setTimeout(() => reject(new Error('Content retrieval timed out')), 10000)
    //);
    //const content = await Promise.race([contentPromise, timeoutPromise]);
    //Content: ${content.slice(0, 500)}  // Limiting content to 500 characters to avoid exceeding token limits
    //console.log(`Content received for tab ${tab.id}, length: ${content.length}`);

    const prompt = `Analyze the following web page URL and title then categorize it into the categories like Work, Entertainment, Shopping, Social Media, Education, News, Technology, Finance, Travel, Health, or Other etc. Don't restrict yourself to the example categories provided. Provide only the category name as the answer.

    URL: ${tab.url} 
    Title: ${tab.title}

    Category:`;

    console.log(`Sending request to Cohere API for tab ${tab.id}`);
    const response = await fetch('https://api.cohere.ai/v1/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${COHERE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'command-nightly',
        prompt: prompt,
        max_tokens: 10,
        temperature: 0.2,
        k: 0,
        stop_sequences: ["\n"],
        return_likelihoods: 'NONE'
      }),
    });


    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    let data;
    try {
      console.log(`Received response from Cohere API for tab ${tab.id}`);
      data = await response.json();
      console.log('Received from Cohere API:', JSON.stringify(data, null, 2));
    } catch (jsonError) {
      console.error('Error parsing JSON:', jsonError);
      throw new Error('Invalid JSON response from API');
    }

    if (!data.generations || data.generations.length === 0) {
      throw new Error('No generations returned from the API');
    }

    const category = data.generations[0].text.trim();
    console.log(`Category determined for tab ${tab.id}: ${category}`);

    // Cache the category
    await cacheCategory(tab.url, category);
    return category;
  } catch (error) {
    console.error(`Error in categorizeTab for tab ${tab.id}:`, error);
    return 'Other';
  }
}

async function categorizeTabWithRetry(tab, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await categorizeTab(tab);
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) {
        console.error(`All ${maxRetries} attempts failed. Returning 'Other' as category.`);
        return 'Other';
      }
      // Wait for a short time before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Function to categorize multiple tabs using Cohere's API
async function categorizeTabs(tabs) {
  const results = [];
  for (let i = 0; i < tabs.length; i += BATCH_SIZE) {
    const batch = tabs.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(tab => categorizeTabWithRetry(tab));
    
    try {
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      console.log(`Categorized batch ${Math.floor(i / BATCH_SIZE) + 1}:`, batchResults);
    } catch (error) {
      console.error(`Error categorizing batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
      results.push(...batch.map(() => 'Other'));
    }
  }
  return results;
}

// Add this function to your background.js file
async function getTabCategories() {
  return new Promise((resolve) => {
    chrome.storage.local.get('tabCategories', (result) => {
      resolve(result.tabCategories || {});
    });
  });
}

// Also add the corresponding function to set tab categories
async function setTabCategories(categories) {
  console.log('Set TabCategories:', categories.toString());
  return new Promise((resolve) => {
    chrome.storage.local.set({ tabCategories: categories }, resolve);
  });
}
async function cacheCategory(url, category) {
  console.log(`Cached category for url ${url}: ${category}`);
  return new Promise((resolve) => {
    chrome.storage.local.set({[url]: category}, resolve);
  });
}
async function getCategoryList(windowId) {
  try {
    const allCategories = {};
    const groupedTabs = {};
    const tabCategories = await getTabCategories();
    
    let window;
    try {
      window = await chrome.windows.get(windowId, { populate: true });
    } catch (windowError) {
      console.log(`Window with id ${windowId} not found. Using current window.`);
      const currentWindow = await chrome.windows.getCurrent({ populate: true });
      window = currentWindow;
    }
    
    if (window && window.tabs && Array.isArray(window.tabs)) {
      for (const tab of window.tabs) {
        const category = tabCategories[tab.id] || 'Uncategorized';
        console.log(`Tab ${tab.id}: stored category =`, category);
        allCategories[category] = (allCategories[category] || 0) + 1;
      }

      const groups = await chrome.tabGroups.query({ windowId: window.id });
      for (const group of groups) {
        if (!groupedTabs[group.title]) {
          groupedTabs[group.title] = [];
        }
        groupedTabs[group.title].push(group.id);
      }
    }

    const allWindows = await chrome.windows.getAll();
    console.log('Final categories:', allCategories);
    console.log('Grouped tabs:', groupedTabs);
    return { 
      categories: allCategories, 
      groupedTabs: groupedTabs, 
      windowCount: allWindows.length
    };
  } catch (error) {
    console.error('Error in getCategoryList:', error);
    return { categories: {}, groupedTabs: {}, windowCount: 0, error: error.message };
  }
}
async function combineAllWindows(removeDuplicates) {
  try {
    let windows = await chrome.windows.getAll({populate: true});
    if (windows.length <= 1) {
      return { success: false, message: 'There is only one window. Nothing to combine.' };
    }

    const targetWindow = windows[0];
    const seenUrls = new Set();
    let duplicatesRemoved = 0;
    let tabsMoved = 0;
    const categoryGroups = new Map();

    // First, get all existing groups in the target window
    const existingGroups = await chrome.tabGroups.query({windowId: targetWindow.id});
    for (const group of existingGroups) {
      categoryGroups.set(group.title, {groupId: group.id, tabIds: []});
    }

    // Process all tabs from all windows
    for (const window of windows) {
      try {
        // Check if the window still exists
        await chrome.windows.get(window.id);
        
        for (const tab of window.tabs) {
          if (removeDuplicates && seenUrls.has(tab.url)) {
            if (tab.windowId !== targetWindow.id) {
              await chrome.tabs.remove(tab.id);
              duplicatesRemoved++;
            }
            continue;
          }
          
          seenUrls.add(tab.url);
          const category = await getCategoryForTab(tab);
          
          if (!categoryGroups.has(category)) {
            categoryGroups.set(category, {groupId: null, tabIds: []});
          }
          categoryGroups.get(category).tabIds.push(tab.id);
          
          if (tab.windowId !== targetWindow.id) {
            tabsMoved++;
          }
        }
      } catch (windowError) {
        console.log(`Window ${window.id} no longer exists, skipping.`);
        continue;
      }
    }

    // Move and group tabs
    for (const [category, groupInfo] of categoryGroups) {
      const {groupId, tabIds} = groupInfo;
      
      // Move tabs to target window if they're not already there
      const tabsToMove = tabIds.filter(id => {
        const tab = windows.flatMap(w => w.tabs).find(t => t.id === id);
        return tab && tab.windowId !== targetWindow.id;
      });
      
      if (tabsToMove.length > 0) {
        try {
          await chrome.tabs.move(tabsToMove, {windowId: targetWindow.id, index: -1});
        } catch (moveError) {
          console.log(`Failed to move some tabs, they may no longer exist.`);
        }
      }
      
      // Group tabs
      try {
        if (groupId) {
          // Add to existing group
          await chrome.tabs.group({groupId: groupId, tabIds: tabIds});
        } else {
          // Create new group
          const newGroupId = await chrome.tabs.group({createProperties: {windowId: targetWindow.id}, tabIds: tabIds});
          await chrome.tabGroups.update(newGroupId, {title: category, collapsed: true});
        }
      } catch (groupError) {
        console.log(`Failed to group tabs for category ${category}, some tabs may no longer exist.`);
      }
    }

    // Close other windows
    for (let i = 1; i < windows.length; i++) {
      try {
        await chrome.windows.remove(windows[i].id);
      } catch (removeError) {
        console.log(`Failed to remove window ${windows[i].id}, it may no longer exist.`);
      }
    }

    let message = `All windows combined successfully. ${tabsMoved} tab(s) moved.`;
    if (removeDuplicates) {
      message += ` ${duplicatesRemoved} duplicate tab(s) removed.`;
    }
    // Ensure all groups in the combined window are collapsed
    await collapseAllGroups(targetWindow.id);
    // After all operations are complete
    await mergeGroupsWithSameCategory(targetWindow.id);
    await notifyPopupOfUpdate();

    return { success: true, message: message };
  } catch (error) {
    console.error('Error combining windows:', error);
    await notifyPopupOfUpdate(); // Notify even on error
    return { success: false, message: `An error occurred: ${error.message}` };
  }
}

// Helper function to get category for a tab
async function getCategoryForTab(tab) {
  const tabCategories = await getTabCategories();
  return tabCategories[tab.id] || 'Uncategorized';
}

async function collapseAllGroups(windowId) {
  const groups = await chrome.tabGroups.query({ windowId: windowId });
  for (const group of groups) {
    await chrome.tabGroups.update(group.id, { collapsed: true });
  }
}

async function organizeTabs(windowId, option, selectedCategories) {
  console.log(`Organizing tabs in window ${windowId} with option: ${option}, categories: ${selectedCategories}`);

  try {
    const window = await chrome.windows.get(windowId);
    if (window.type !== 'normal') {
      return { success: false, message: 'Tab organization is only supported in normal windows. Please try again in a regular Chrome window.' };
    }

    const tabs = await chrome.tabs.query({windowId: windowId});
    const tabCategories = await getTabCategories();
    const categoriesToProcess = new Set(selectedCategories);
    let groupedCount = 0;
    let ungroupedCount = 0;
    let movedCount = 0;
    let message = '';
    switch (option) {
      case 'groupTabs':
        for (const category of categoriesToProcess) {
          const tabsInCategory = tabs.filter(tab => (tabCategories[tab.id] || 'Uncategorized') === category);
          console.log(`Found ${tabsInCategory.length} tabs in category ${category}`);
          if (tabsInCategory.length > 0) {
            try {
              const groupId = await chrome.tabs.group({tabIds: tabsInCategory.map(tab => tab.id)});
              console.log(`Created group with ID ${groupId} for category ${category}`);
              await chrome.tabGroups.update(groupId, {title: category, collapsed: true});
              console.log(`Updated group ${groupId} with title ${category} and collapsed it`);
              groupedCount += tabsInCategory.length;
            } catch (error) {
              console.error(`Error grouping tabs for category ${category}:`, error);
              // Instead of returning immediately, we'll continue with other categories
              continue;
            }
          }
        }
        
        // Ensure all remaining groups in the original window are collapsed
        const remainingGroups = await chrome.tabGroups.query({windowId: windowId});
        for (const group of remainingGroups) {
          await chrome.tabGroups.update(group.id, {collapsed: true});
        }
        
        console.log(`${groupedCount} tabs grouped successfully`);
        message = `${groupedCount} tabs were grouped.`;
        break;

      case 'ungroupTabs':
        const groups = await chrome.tabGroups.query({windowId: windowId});
        for (const group of groups) {
          if (categoriesToProcess.has(group.title)) {
            const groupTabs = await chrome.tabs.query({groupId: group.id});
            await chrome.tabs.ungroup(groupTabs.map(tab => tab.id));
            ungroupedCount += groupTabs.length;
          }
        }
        console.log(`${ungroupedCount} tabs ungrouped successfully`);
        message = `${ungroupedCount} tabs were ungrouped.`;
        break;
      case 'separateWindows':
        movedCount = await separateWindows(windowId, categoriesToProcess);
        message = `${movedCount} tabs were moved to a new window.`;
        break;
      case 'ungroupAllTabs':
        const allTabs = await chrome.tabs.query({windowId: windowId});
        await chrome.tabs.ungroup(allTabs.map(tab => tab.id));
        console.log('All tabs ungrouped successfully');
        message = 'All tabs were ungrouped.';
        break;

      default:
        return { success: false, message: 'Invalid organization option' };
    }
    
    // After organization is complete, get the updated category list
    const updatedCategoryList = await getCategoryList(windowId);

    return { 
      success: true, 
      message: message,
      ...updatedCategoryList 
    };
  } catch (error) {
    console.error('Error in organizeTabs:', error);
    return { success: false, message: `An error occurred: ${error.message}` };
  }
}

async function organizeIntoSeparateWindows(validTabs, categories, selectedCategories) {
  for (const category of selectedCategories) {
    const categoryTabs = validTabs.filter((tab, index) => categories[index] === category);
    if (categoryTabs.length > 0) {
      const newWindow = await chrome.windows.create({ focused: false, state: 'normal' });
      await chrome.tabs.move(categoryTabs.map(tab => tab.id), { windowId: newWindow.id, index: -1 });
    }
  }
}

async function organizeIntoGroups(validTabs, categories, selectedCategories) {
  // Ungroup all tabs first
  await chrome.tabs.ungroup(validTabs.map(tab => tab.id));
  
  for (const category of selectedCategories) {
    const categoryTabs = validTabs.filter((tab, index) => categories[index] === category);
    if (categoryTabs.length > 0) {
      const groupId = await chrome.tabs.group({tabIds: categoryTabs.map(tab => tab.id)});
      await chrome.tabGroups.update(groupId, {title: category, collapsed: true});
    }
  }
}

// Add this function to combine all tabs
async function combineAllTabs(selectedCategories = []) {
  try {
    const windows = await chrome.windows.getAll({populate: true});
    if (windows.length <= 1 && selectedCategories.length === 0) {
      return { success: false, message: 'There is only one window. Nothing to combine.' };
    }

    const targetWindow = windows[0];
    const tabCategories = await getTabCategories();
    const tabsToMove = [];

    for (let i = 1; i < windows.length; i++) {
      const windowTabs = selectedCategories.length > 0
        ? windows[i].tabs.filter(tab => selectedCategories.includes(tabCategories[tab.id]))
        : windows[i].tabs;
      tabsToMove.push(...windowTabs.map(tab => tab.id));
    }

    if (tabsToMove.length > 0) {
      await chrome.tabs.move(tabsToMove, { windowId: targetWindow.id, index: -1 });
    }

    const message = selectedCategories.length > 0
      ? `Tabs from selected categories combined into one window`
      : 'All tabs combined into one window';
    return { success: true, message: message };
  } catch (error) {
    console.error('Error combining tabs:', error);
    return { success: false, message: error.message };
  }
}

// Add this function to get grouped tabs
async function getGroupedTabs(windowId) {
  const groups = await chrome.tabGroups.query({windowId: windowId});
  const groupedTabs = {};
  
  for (const group of groups) {
    const tabs = await chrome.tabs.query({groupId: group.id});
    groupedTabs[group.title] = tabs.length;
  }
  
  return groupedTabs;
}

async function toggleGroupCollapse(windowId, groupId, collapsed) {
  try {
    const group = await chrome.tabGroups.update(groupId, {collapsed: collapsed});
    const tabs = await chrome.tabs.query({groupId: groupId});
    const tabCategories = await getTabCategories();
    const updatedCategory = tabCategories[tabs[0].id] || 'Uncategorized';
    
    // Ensure all tabs in this group are actually supposed to be in this group
    for (const tab of tabs) {
      const tabCategory = tabCategories[tab.id] || 'Uncategorized';
      if (tabCategory !== updatedCategory) {
        // This tab shouldn't be in this group, remove it
        await chrome.tabs.ungroup(tab.id);
      }
    }

    return { 
      success: true, 
      message: `Group ${collapsed ? 'collapsed' : 'expanded'} successfully`,
      updatedCategory: updatedCategory
    };
  } catch (error) {
    console.error('Error toggling group collapse:', error);
    return { success: false, message: error.message };
  }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in background:', request);
  
  let handler;
  switch (request.action) {
    case 'getCategoryList':
      handler = () => getCategoryList(request.windowId);
      break;
    case 'combineAllWindows':
      handler = () => combineAllWindows(request.removeDuplicates);
      break;
    case 'getGroupedTabs':
      handler = () => getGroupedTabs(request.windowId);
      break;
    case 'organizeTabs':
      handler = () => organizeTabs(request.windowId, request.option, request.categories);
      break;
    case 'getTabCategories':
      handler = () => getTabCategories();
      break;
    case 'combineTabs':
      handler = () => combineAllTabs(request.categories);
      break;
    case 'toggleGroupCollapse':
      handler = () => chrome.tabGroups.update(request.groupId, { collapsed: request.collapsed });
      break;
    default:
      console.error('Unknown action:', request.action);
      sendResponse({error: 'Unknown action'});
      return false;
  }

  handler().then(result => {
    console.log(`Result for ${request.action}:`, result);
    // Check if we can still send a response
    if (chrome.runtime.lastError) {
      console.warn('Cannot send response, message port closed.');
    } else {
      sendResponse(result);
    }
  }).catch(error => {
    console.error(`Error handling ${request.action}:`, error);
    // Check if we can still send a response
    if (chrome.runtime.lastError) {
      console.warn('Cannot send response, message port closed.');
    } else {
      sendResponse({error: error.message});
    }
  });

  return true; // Indicates that the response is sent asynchronously
});

// Add this function to categorize and cache a tab
async function categorizeAndCacheTab(tab) {
  console.log(`Categorizing and caching tab ${tab.id} with URL: ${tab.url}`);
  
  // First, check if we have a cached category for this URL
  const cachedCategory = await getCachedCategory(tab.url);
  if (cachedCategory) {
    console.log(`Using cached category for tab ${tab.id}: ${cachedCategory}`);
    const tabCategories = await getTabCategories();
    tabCategories[tab.id] = cachedCategory;
    await setTabCategories(tabCategories);
    return cachedCategory;
  }

  // If not cached, categorize the tab
  const category = await categorizeTabWithRetry(tab);
  const tabCategories = await getTabCategories();
  tabCategories[tab.id] = category;
  await setTabCategories(tabCategories);
  console.log(`Tab ${tab.id} categorized as ${category}`);
  return category;
}

// Add these functions to handle URL-based category caching
async function getCachedCategory(url) {
  return new Promise((resolve) => {
    chrome.storage.local.get(url, (result) => {
      if (result[url]) {
        console.log(`Found cached category for URL ${url}: ${result[url]}`);
      }
      resolve(result[url] || null);
    });
  });
}




// Add this function to clear the URL cache periodically
function setupCacheCleaning() {
  const CACHE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(async () => {
    console.log('Clearing URL category cache');
    await chrome.storage.local.clear();
  }, CACHE_CLEANUP_INTERVAL);
}


// Function to remove duplicate tabs (only called from context menu)
async function removeDuplicateTabs(windowId) {
  const tabs = await chrome.tabs.query({windowId: windowId});
  const urlToTabMap = new Map();
  const tabsToRemove = [];

  // Sort tabs by ID in descending order (most recent first)
  tabs.sort((a, b) => b.id - a.id);

  for (const tab of tabs) {
    if (urlToTabMap.has(tab.url)) {
      // This is a duplicate, add it to the removal list
      tabsToRemove.push(tab.id);
    } else {
      // This is the first (most recent) occurrence of this URL
      urlToTabMap.set(tab.url, tab);
    }
  }

  if (tabsToRemove.length > 0) {
    await chrome.tabs.remove(tabsToRemove);
    return tabsToRemove.length;
  }

  return 0;
}

// Function to create the context menu item
function createContextMenu() {
  chrome.contextMenus.create({
    id: "removeDuplicates",
    title: "Remove Duplicate Tabs",
    contexts: ["action"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.log("Context menu item already exists:", chrome.runtime.lastError.message);
    } else {
      console.log("Context menu item created successfully");
    }
  });
}


// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "removeDuplicates") {
    chrome.windows.getCurrent({populate: true}, async (window) => {
      const removedCount = await removeDuplicateTabs(window.id);
      chrome.action.setBadgeText({text: removedCount.toString()});
      setTimeout(() => chrome.action.setBadgeText({text: ''}), 3000);
      
      // Check if we can send a message to the popup
      chrome.runtime.sendMessage({ action: 'duplicatesRemoved', count: removedCount }, response => {
        if (chrome.runtime.lastError) {
          // Popup is not open, no need to handle this error
          console.log("Popup is not open, couldn't send message");
        } else {
          console.log("Message sent to popup successfully");
        }
      });
    });
  }
});

async function separateWindows(windowId, categoriesToProcess) {
  console.log('Starting separateWindows function');
  console.log('Categories to process:', categoriesToProcess);
  let movedCount = 0;
  try {
    const tabCategories = await getTabCategories();
    console.log('Tab categories:', tabCategories);
    const tabs = await chrome.tabs.query({windowId: windowId});
    console.log('All tabs in current window:', tabs.length);
    
    const tabsToMove = tabs.filter(tab => {
      const category = tabCategories[tab.id] || 'Uncategorized';
      const shouldMove = categoriesToProcess.has(category);
      console.log(`Tab ${tab.id} (${tab.url}) - Category: ${category}, Should move: ${shouldMove}`);
      return shouldMove;
    });

    console.log('Tabs to move:', tabsToMove.length);

    if (tabsToMove.length > 0) {
      console.log('Creating new window');
      const newWindow = await chrome.windows.create({ focused: false, state: 'normal' });
      console.log('New window created:', newWindow.id);

      console.log('Moving tabs to new window');
      await chrome.tabs.move(tabsToMove.map(tab => tab.id), { windowId: newWindow.id, index: -1 });
      movedCount = tabsToMove.length;

      console.log('Grouping tabs in new window');
      for (const category of categoriesToProcess) {
        const categoryTabs = tabsToMove.filter(tab => (tabCategories[tab.id] || 'Uncategorized') === category);
        console.log(`Grouping ${categoryTabs.length} tabs for category ${category}`);
        if (categoryTabs.length > 0) {
          const groupId = await chrome.tabs.group({tabIds: categoryTabs.map(tab => tab.id), createProperties: {windowId: newWindow.id}});
          await chrome.tabGroups.update(groupId, {title: category, collapsed: true});
        }
      }

      console.log('Removing empty tab');
      const emptyTabs = await chrome.tabs.query({ windowId: newWindow.id, url: 'chrome://newtab/' });
      if (emptyTabs.length > 0) {
        await chrome.tabs.remove(emptyTabs[0].id);
      }
      // Ensure all remaining groups in the new window are collapsed
      await collapseAllGroups(newWindow.id);

      // Ensure all remaining groups in the original window are collapsed
      await collapseAllGroups(windowId);
      console.log('Focusing new window');
      await chrome.windows.update(newWindow.id, { focused: true });
    } else {
      console.log('No tabs to move');
    }
  } catch (error) {
    console.error('Error in separateWindows:', error);
  }

  console.log(`Moved ${movedCount} tabs`);
  return movedCount;
}


// Define the updateTabCategory function
async function updateTabCategory(tab) {
  console.log(`Categorizing and caching tab ${tab.id} with URL: ${tab.url}`);
  try {
    const category = await categorizeAndCacheTab(tab);
    console.log(`Tab ${tab.id} categorized as: ${category}`);
    return category;
  } catch (error) {
    console.error(`Error categorizing tab ${tab.id}:`, error);
  }
}

// Modify the handleNewTab function
async function handleNewTab(tab) {
  try {
    console.log(`Handling tab: ${tab.id}, URL: ${tab.url}`);
    
    // Only proceed if the tab has a valid URL
    if (!tab.url || tab.url.startsWith('chrome://')) {
      console.log(`Skipping categorization for tab ${tab.id} (chrome or empty page)`);
      return;
    }

    const window = await chrome.windows.get(tab.windowId);
    if (window.type !== 'normal') {
      console.log(`Skipping grouping for tab ${tab.id} (non-normal window)`);
      return;
    }

    const category = await updateTabCategory(tab);
    console.log(`Category for tab ${tab.id}: ${category}`);
    
    // Find an existing group with the same category in the same window
    const groups = await chrome.tabGroups.query({windowId: tab.windowId});
    console.log(`Existing groups in window ${tab.windowId}:`, groups);

    const matchingGroup = groups.find(group => group.title === category);
    
    if (matchingGroup) {
      console.log(`Adding tab ${tab.id} to existing group ${matchingGroup.id} (${category})`);
      await chrome.tabs.group({tabIds: tab.id, groupId: matchingGroup.id});
    } else {
      console.log(`Need to create new group for category ${category} and will be done when user requests it`);
      //console.log(`Creating new group for category ${category}`);
     // const groupId = await chrome.tabs.group({tabIds: tab.id});
     // await chrome.tabGroups.update(groupId, {title: category, collapsed: true});
    }
    notifyCategoryMapPopupOfUpdate();
  } catch (error) {
    console.error('Error in handleNewTab:', error);
  }
}

// Replace the notifyPopupOfUpdate function with this:
async function notifyPopupOfUpdate() {
  try {
    await chrome.storage.local.set({ popupNeedsUpdate: true });
  } catch (error) {
    console.error("Error setting update flag:", error);
  }
}

// Add this function to your background.js
function notifyCategoryMapPopupOfUpdate() {
  chrome.runtime.sendMessage({ action: "updateCategoryMapPopup" }, response => {
    if (chrome.runtime.lastError) {
      // Popup is not open, no need to handle this error
      console.log("Popup is not open, couldn't send message");
    } else {
      console.log("Message sent to popup successfully");
    }
  });
}
// Make sure these functions are defined elsewhere in your code:
// - categorizeUrl(url)
// - cacheTabCategory(tabId, category)
// - getTabCategories()

async function mergeGroupsWithSameCategory(windowId) {
  const groups = await chrome.tabGroups.query({windowId: windowId});
  const categoryGroups = {};

  for (const group of groups) {
    if (!categoryGroups[group.title]) {
      categoryGroups[group.title] = [];
    }
    categoryGroups[group.title].push(group);
  }

  for (const [category, groupsArray] of Object.entries(categoryGroups)) {
    if (groupsArray.length > 1) {
      const targetGroupId = groupsArray[0].id;
      for (let i = 1; i < groupsArray.length; i++) {
        const tabs = await chrome.tabs.query({groupId: groupsArray[i].id});
        await chrome.tabs.group({tabIds: tabs.map(tab => tab.id), groupId: targetGroupId});
        // The empty group will be automatically removed by Chrome
      }
    }
  }
}

