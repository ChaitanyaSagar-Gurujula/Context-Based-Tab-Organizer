# Context-Based Tab Organizer

## Description

Context-Based Tab Organizer is a powerful Chrome extension that helps users efficiently manage and organize their browser tabs using AI-powered categorization. This extension automatically categorizes tabs based on their content and provides intuitive tools for grouping, ungrouping, and managing tabs across multiple windows.

## Features

1. **AI-Powered Tab Categorization**: Utilizes the Cohere API to automatically categorize tabs based on their web page title and URL.
2. **Tab Grouping**: Group tabs by category within the same window.
3. **Tab Ungrouping**: Easily ungroup tabs that have been previously grouped.
4. **Separate Windows**: Move selected categories of tabs to new windows.
5. **Combine Windows**: Merge tabs from all windows into a single window, with an option to remove duplicates.
6. **Duplicate Tab Removal**: Option to remove duplicate tabs when combining windows or through the context menu.
7. **Category Management**: Select all or individual categories for organization actions.
8. **Group Collapsing**: Collapse or expand tab groups directly from the extension popup.
9. **Context Menu Integration**: Quick access to remove duplicate tabs across all windows.
10. **Auto-categorization**: Automatically categorizes tabs when the extension is installed.

## Installation

1. Clone this repository or download the source code.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable "Developer mode" in the top right corner.
4. Click "Load unpacked" and select the directory containing the extension files.

## Usage

1. As soon as u install the extension, categorization process is initiated for the existing tabs across all windows.
2. Click on the extension icon in the Chrome toolbar to open the popup to see the categories.
3. Select categories and use the organization options (Group, Ungroup, Separate Windows) as needed.
4. Use the "Combine All Windows" button to merge tabs from all windows into the current window.
4. Toggle the "Remove Duplicates" option to automatically remove duplicate tabs when combining windows.

## Configuration

- The Cohere API key is stored in the `background.js` file. Replace the placeholder API key with your own. In future enhancements, the API key will be stored in the Chrome extension's settings.
- The extension uses Chrome's `chrome.storage.local` API to store and retrieve data, ensuring that the data is persistent across sessions and browser instances.
