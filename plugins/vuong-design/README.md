# vuong-design

Static HTML → design system → Figma with variables, components and IDs, verified node by node.

Work in progress: this is the layout-engine skeleton.

## Setup

- Node >= 18. No npm dependencies in this plugin.
- Playwright is looked up in `$VD_PLAYWRIGHT_FROM` (a directory containing `node_modules/playwright` or `node_modules/playwright-core`), then in the current project's `node_modules`. Nothing is installed automatically.
- Uses the Chromium already installed by Playwright (`ms-playwright/chromium-*`); it never downloads a browser.

## Tests

```
VD_PLAYWRIGHT_FROM=/path/to/dir node --test plugins/vuong-design/test/
```
