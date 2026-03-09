# Auto Refresh Extension

A Chrome extension that automatically refreshes the current page at a specified time interval.

## Features

- **Customizable Interval**: Set refresh intervals from 1 to 3600 seconds
- **Per-Tab Control**: Each tab maintains its own refresh settings
- **Visual Status**: Clear ON/OFF status indicator with countdown timer
- **Persistent**: Continues refreshing even when the popup is closed
- **Clean UI**: Modern, dark-themed interface

## Installation

### Method 1: Load as Unpacked Extension (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** by toggling the switch in the top right corner
3. Click **Load unpacked**
4. Select the `Auto-Refresh-Extension` folder
5. The extension will appear in your toolbar

### Method 2: Pack Extension (Optional)

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Pack extension**
4. Select the extension directory
5. Chrome will create a `.crx` file you can distribute

## Usage

1. Click on the Auto Refresh extension icon in your Chrome toolbar
2. Enter the desired refresh interval in seconds (1-3600)
3. Click **Start** to begin auto-refreshing
4. The status will change to **ON** and show a countdown timer
5. Click **Stop** to disable auto-refresh

## File Structure

```
Auto-Refresh-Extension/
├── manifest.json      # Extension configuration
├── popup.html         # Popup UI structure
├── popup.css          # Popup styling
├── popup.js           # Popup logic and UI handling
├── background.js      # Background service worker for refresh logic
├── icons/
│   ├── icon16.png     # 16x16 icon
│   ├── icon48.png     # 48x48 icon
│   ├── icon128.png    # 128x128 icon
│   └── icon.svg       # Source SVG icon
└── README.md          # This file
```

## Technical Details

- **Manifest Version**: 3 (latest Chrome extension standard)
- **Permissions Used**:
  - `tabs`: To reload tabs
  - `storage`: To persist refresh settings
  - `alarms`: To schedule refreshes reliably

## License

MIT License - Feel free to use and modify as needed.
