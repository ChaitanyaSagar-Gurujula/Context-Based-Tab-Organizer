let currentWindowId;
let categoryList;
let organizationOptions;
let selectAllCheckbox;
const removeDuplicatesCheckbox = document.getElementById('removeDuplicates');
const bottomOptions = document.getElementById('bottomOptions');
const combineAllWindowsButton = document.getElementById('combineAllWindowsButton');
const messageArea = document.getElementById('messageArea');

// Add this function at the beginning of your popup.js file
function checkForUpdates() {
  chrome.storage.local.get(['popupNeedsUpdate'], function(result) {
    if (result.popupNeedsUpdate) {
      refreshPopup();
      chrome.storage.local.set({ popupNeedsUpdate: false });
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  categoryList = document.getElementById('categoryList');
  organizationOptions = document.getElementById('organizationOptions');
  selectAllCheckbox = document.getElementById('selectAll');
  
  const groupTabsButton = document.getElementById('groupTabsButton');
  if (groupTabsButton) {
    groupTabsButton.addEventListener('click', () => handleOrganizationOption('groupTabs'));
  }

  const separateWindowsButton = document.getElementById('separateWindowsButton');
  if (separateWindowsButton) {
    separateWindowsButton.addEventListener('click', () => handleOrganizationOption('separateWindows'));
  }

  const ungroupTabsButton = document.getElementById('ungroupTabsButton');
  if (ungroupTabsButton) {
    ungroupTabsButton.addEventListener('click', () => handleOrganizationOption('ungroupTabs'));
  }

  if (combineAllWindowsButton) {
    combineAllWindowsButton.addEventListener('click', handleCombineAllWindows);
  }

  if (removeDuplicatesCheckbox) {
    removeDuplicatesCheckbox.addEventListener('change', handleRemoveDuplicates);
  }

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', handleSelectAll);
  }

  refreshPopup();
  
  // Add this line to check for updates periodically
  setInterval(checkForUpdates, 1000); // Check every second

  highlightCurrentTabCategory();

  document.getElementById('viewAllTabsButton').addEventListener('click', () => {
    chrome.windows.create({
      url: 'tabList.html',
      type: 'popup',
      width: 400,
      height: 600
    });
  });
});


async function displayCategoryList(categories, groupedTabs, windowCount) {
  if (!categories || typeof categories !== 'object') {
    console.error('Invalid categories object:', categories);
    displayError('Invalid category data received. Please try again.');
    return;
  }

  if (!categoryList) {
    console.error('Category list element not found');
    return;
  }

  categoryList.innerHTML = '';
  categoryList.style.display = 'block';
  
  if (organizationOptions) {
    organizationOptions.style.display = 'flex';
  } else {
    console.warn('organizationOptions element not found');
  }

  const categoryCount = Object.keys(categories).length;
  const hasGroupedTabs = groupedTabs && Object.keys(groupedTabs).length > 0;
  const allTabsGrouped = hasGroupedTabs && 
    Object.values(categories).reduce((sum, count) => sum + count, 0) === 
    Object.values(groupedTabs).reduce((sum, tabs) => sum + tabs.length, 0);

  if (Object.keys(categories).length === 0) {
    categoryList.innerHTML = '<p>No categories found. Try refreshing the page.</p>';
    return;
  }

  // Sort categories alphabetically, but keep "Uncategorized" at the end
  const sortedCategories = Object.entries(categories).sort((a, b) => {
    if (a[0] === 'Uncategorized') return 1;
    if (b[0] === 'Uncategorized') return -1;
    return a[0].localeCompare(b[0]);
  });

  for (const [category, count] of sortedCategories) {
    const item = document.createElement('div');
    item.className = 'category-item';
    const isGrouped = groupedTabs && groupedTabs[category] && groupedTabs[category].length > 0;

    item.innerHTML = `
      <div class="category-label">
        <input type="checkbox" id="${category}" name="category" value="${category}">
        <label for="${category}">${category} (${count}) ${isGrouped ? '<span class="grouped">(Grouped)</span>' : ''}</label>
      </div>
      <div class="toggle-container"></div>
    `;

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.checked = isGrouped || allTabsGrouped;

    const toggleContainer = item.querySelector('.toggle-container');

    if (isGrouped && groupedTabs[category]) {
      groupedTabs[category].forEach(groupId => {
        const toggleSwitch = document.createElement('label');
        toggleSwitch.className = 'small-toggle-switch';
        toggleSwitch.innerHTML = `
          <input type="checkbox" id="toggle-${groupId}" class="group-toggle" data-group-id="${groupId}">
          <span class="slider"></span>
        `;
        toggleContainer.appendChild(toggleSwitch);
        const toggleInput = toggleSwitch.querySelector('input');
        toggleInput.addEventListener('change', (e) => handleToggleCollapse(groupId, !e.target.checked));
      });
    }

    categoryList.appendChild(item);
  }

  updateSelectAllCheckbox();
  updateCombineButtons(windowCount);
  await updateGroupToggleStates();

  await highlightCurrentTabCategory();
}

function handleSelectAll() {
  const isChecked = selectAllCheckbox.checked;
  const categoryCheckboxes = document.querySelectorAll('input[name="category"]');
  categoryCheckboxes.forEach(checkbox => {
    checkbox.checked = isChecked;
  });
}

function updateSelectAllCheckbox() {
  const categoryCheckboxes = document.querySelectorAll('input[name="category"]');
  const allChecked = Array.from(categoryCheckboxes).every(checkbox => checkbox.checked);
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = allChecked;
  }
}

async function handleOrganizationOption(option) {
  let selectedCategories = getSelectedCategories();
  
  console.log('Selected categories:', selectedCategories);

  if (selectedCategories.length === 0 && option !== 'ungroupAllTabs') {
    showMessage('Please select at least one category', true);
    return;
  }

  try {
    const window = await chrome.windows.getCurrent({populate: true});
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ 
        action: 'organizeTabs',
        windowId: window.id,
        option: option,
        categories: selectedCategories
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });

    console.log('Tabs organization response:', response);
    if (response.success) {
      showMessage(response.message);
      await updateCategoryList(response.categories, response.groupedTabs, response.windowCount);
      await updateGroupToggleStates();
    } else {
      showMessage('Failed to organize tabs: ' + (response.message || 'Unknown error'), true);
    }
  } catch (error) {
    console.error('Error in handleOrganizationOption:', error);
    showMessage('An error occurred: ' + error.message, true);
  }
}

function getSelectedCategories() {
  const categoryCheckboxes = document.querySelectorAll('input[name="category"]');
  return Array.from(categoryCheckboxes)
    .filter(checkbox => checkbox.checked)
    .map(checkbox => checkbox.value);
}

async function handleToggleCollapse(groupId, shouldCollapse) {
  try {
    await chrome.tabGroups.update(groupId, { collapsed: shouldCollapse });
    console.log(`Group ${groupId} ${shouldCollapse ? 'collapsed' : 'expanded'}`);
    
    // Update the toggle switch state
    const toggleElement = document.querySelector(`#toggle-${groupId}`);
    if (toggleElement) {
      toggleElement.checked = !shouldCollapse;
    }
  } catch (error) {
    console.error('Error toggling group collapse:', error);
    showMessage('Failed to toggle group. The group may no longer exist.', true);
    // Remove the toggle if the group doesn't exist
    const toggleSwitch = document.querySelector(`#toggle-${groupId}`).closest('.small-toggle-switch');
    if (toggleSwitch) {
      toggleSwitch.remove();
    }
  }
}

async function setInitialToggleState(toggleInput, tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const group = await chrome.tabGroups.get(tab.groupId);
    toggleInput.checked = !group.collapsed;
  } catch (error) {
    console.error('Error setting initial toggle state:', error);
  }
}

function updateCombineButtons(windowCount) {
  if (windowCount > 1) {
    bottomOptions.style.display = 'block';
    combineAllWindowsButton.style.display = 'block';
  } else {
    bottomOptions.style.display = 'none';
    combineAllWindowsButton.style.display = 'none';
  }
}

function handleCombineAllWindows() {
  const removeDuplicates = removeDuplicatesCheckbox.checked;
  chrome.runtime.sendMessage({ 
    action: 'combineAllWindows',
    removeDuplicates: removeDuplicates
  }, function(response) {
    if (chrome.runtime.lastError) {
      console.error('Error sending message:', chrome.runtime.lastError);
      showMessage('An error occurred: ' + chrome.runtime.lastError.message, true);
    } else {
      console.log('Combine all windows response:', response);
      if (response.success) {
        showMessage(response.message);
      } else {
        showMessage('Failed to combine windows: ' + (response.message || 'Unknown error'), true);
      }
    }
    
    // Force a refresh of the popup immediately after the combine operation
    setTimeout(() => {
      refreshPopup();
    }, 500); // Small delay to allow for window operations to complete
  });
}

function displayError(message) {
  if (categoryList) {
    categoryList.innerHTML = `<p style="color: red;">${message}</p>`;
    categoryList.style.display = 'block';
  }
  if (organizationOptions) {
    organizationOptions.style.display = 'none';
  }

}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'duplicatesRemoved') {
    showMessage(`${request.count} duplicate tab(s) removed.`);
    refreshPopup();
  }
  if (request.action === "updatePopup") {
    refreshPopup();
  }
  return true;
});

function handleRemoveDuplicates() {
  const shouldRemoveDuplicates = removeDuplicatesCheckbox.checked;
  chrome.storage.local.set({ removeDuplicates: shouldRemoveDuplicates }, () => {
    console.log('Remove duplicates setting updated:', shouldRemoveDuplicates);
  });
}

function showMessage(message, isError = false) {
  messageArea.textContent = message;
  messageArea.className = isError ? 'error' : 'success';
  messageArea.style.opacity = '0';
  messageArea.style.display = 'block';
  
  setTimeout(() => {
    messageArea.style.transition = 'opacity 0.5s ease-in-out';
    messageArea.style.opacity = '1';
  }, 10);

  setTimeout(() => {
    messageArea.style.opacity = '0';
    setTimeout(() => {
      messageArea.style.display = 'none';
    }, 500);
  }, 2000);
}

async function updateGroupToggleStates() {
  console.log('Updating group toggle states');
  try {
    const currentWindow = await chrome.windows.getCurrent();
    const groups = await chrome.tabGroups.query({ windowId: currentWindow.id });
    
    console.log('Current groups:', groups);

    // Remove toggle switches for non-existent groups
    document.querySelectorAll('.group-toggle').forEach(toggle => {
      const groupId = parseInt(toggle.dataset.groupId);
      if (!groups.some(g => g.id === groupId)) {
        console.log(`Removing toggle for non-existent group ${groupId}`);
        toggle.closest('.small-toggle-switch').remove();
      }
    });

    // Update existing toggle switches and add new ones
    groups.forEach(group => {
      let toggleInput = document.querySelector(`#toggle-${group.id}`);
      if (!toggleInput) {
        const categoryItem = Array.from(document.querySelectorAll('.category-item'))
          .find(item => item.querySelector('label').textContent.includes(group.title));
        if (categoryItem) {
          const toggleSwitch = document.createElement('label');
          toggleSwitch.className = 'small-toggle-switch';
          toggleSwitch.innerHTML = `
            <input type="checkbox" id="toggle-${group.id}" class="group-toggle" data-group-id="${group.id}">
            <span class="slider"></span>
          `;
          categoryItem.appendChild(toggleSwitch);
          toggleInput = toggleSwitch.querySelector('input');
          toggleInput.addEventListener('change', (e) => handleToggleCollapse(group.id, !e.target.checked));
        }
      }
      if (toggleInput) {
        toggleInput.checked = !group.collapsed;
      }
    });
  } catch (error) {
    console.error('Error updating group toggle states:', error);
  }
}

async function refreshPopup() {
  console.log('Refreshing popup');
  try {
    const windows = await chrome.windows.getAll({populate: true});
    const currentWindow = windows.find(w => w.focused) || windows[0];
    currentWindowId = currentWindow.id;
    
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getCategoryList', windowId: currentWindowId }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });

    console.log('Received response for category list:', response);

    if (response && response.categories) {
      await displayCategoryList(response.categories, response.groupedTabs, response.windowCount);
      console.log('Category list displayed');
    } else {
      console.error('No categories received from background script');
      displayError('Failed to retrieve category list. Please try again.');
    }
  } catch (error) {
    console.error('Error in refreshPopup:', error);
    displayError('An error occurred while refreshing the popup. Please try again.');
  }
}

async function updateCategoryList() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    const response = await sendMessageToBackground({action: 'getCategoryList', windowId: currentWindow.id});
    
    console.log('Category list response:', response);
    
    if (response && response.categories) {
      await displayCategoryList(response.categories, response.groupedTabs, response.windowCount);
    } else {
      throw new Error('Invalid response received');
    }
  } catch (error) {
    logError(error, 'updateCategoryList');
    if (error.message === 'Response timeout') {
      console.warn('Background script did not respond in time. The popup might have closed.');
    } else if (error.message === "Extension needs to be reloaded. Please refresh the page or restart the browser.") {
      displayError(error.message);
    } else {
      displayError('Failed to update category list. Please try again.');
    }
  }
}

// Add this function to your popup.js
async function highlightCurrentTabCategory() {
  try {
    const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
    const tabCategories = await getTabCategories();
    const currentCategory = tabCategories[activeTab.id] || 'Uncategorized';
    
    // Remove highlight from all categories
    document.querySelectorAll('.category-item').forEach(item => {
      item.style.backgroundColor = '';
    });
    
    // Highlight the current category
    const categoryItem = document.querySelector(`#categoryList .category-item input[value="${currentCategory}"]`);
    if (categoryItem) {
      categoryItem.closest('.category-item').style.backgroundColor = '#e8f0fe';
    }
  } catch (error) {
    console.error('Error highlighting current tab category:', error);
  }
}

async function getTabCategories() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getTabCategories' }, (response) => {
      resolve(response || {});
    });
  });
}

async function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Response timeout'));
    }, 5000);  // 5 second timeout

    chrome.runtime.sendMessage(message, response => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}


async function organizeTabs(option) {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    const selectedCategories = getSelectedCategories();
    const response = await sendMessageToBackground({
      action: 'organizeTabs',
      windowId: currentWindow.id,
      option: option,
      categories: selectedCategories
    });

    if (response.success) {
      displayMessage(response.message, 'success');
      await displayCategoryList(response.categories, response.groupedTabs, response.windowCount);
    } else {
      throw new Error(response.message);
    }
  } catch (error) {
    logError(error, 'organizeTabs');
    displayError(error.message);
  }
}
