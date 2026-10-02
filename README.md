# Nook

A small desktop agenda and calendar that perches in the corner of your screen. Built with Electron — lightweight, always within reach, and gets out of the way when you don't need it.

## Download

Grab the installer and run it — no Node, no terminal, no setup required.

**[⬇ Download Nook Setup 1.0.0.exe](dist/Nook%20Setup%201.0.0.exe)**

It installs to your user folder (no admin rights needed), adds a Start Menu / Desktop shortcut, and registers itself to auto-start on login.

## Features

- **Agenda sidebar** — always-visible list of today's and upcoming tasks, independent of the calendar
- **Calendar view** — toggle it on/off; collapsed by default to stay out of the way
- **Recurring tasks** — repeat a task daily or weekly without re-adding it
- **Reminders** — optional notifications the day before (9pm) or the day of (9am, or the task's own time if set), with catch-up logic if your PC was off when a reminder was due
- **Completed tasks** — tucked into a collapsible "Completed" section with one-click undo
- **Cloud sync (no account needed)** — point it at any folder already synced by Google Drive, OneDrive, Dropbox, etc., and your tasks follow you across devices via that folder
- **System tray** — minimizes to the tray instead of closing; auto-starts with Windows
- **Always-on-top toggle** — pin it above other windows when you want it, or let it sit normally otherwise
- **Rounded, transparent widget window** — anchored to the top-right corner of your screen, click-through outside its edges

## Running from source

Requires [Node.js](https://nodejs.org) (LTS).

```bash
git clone https://github.com/MostafizurRahmanSani/nook.git
cd nook
npm install
npm start
```

## Building the installer yourself

```bash
npm run dist
```

This produces `dist/Nook Setup 1.0.0.exe` via [electron-builder](https://www.electron.build/).

> **Note:** building the installer on Windows requires [Developer Mode](ms-settings:developers) enabled (Settings → Privacy & security → For developers), since electron-builder needs to create symlinks while packaging.

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- Vanilla HTML/CSS/JS — no frameworks, no build step for the app itself
- [electron-builder](https://www.electron.build/) — packaging

## Project structure

```
main.js        Electron main process — window, tray, file I/O, notifications
preload.js     Context-isolated bridge between main and renderer
renderer.js    All UI logic — calendar, agenda, tasks, reminders
index.html     App markup
styles.css     App styling
icon.ico       App/window/tray icon
```

## License

MIT — see [LICENSE](LICENSE).
