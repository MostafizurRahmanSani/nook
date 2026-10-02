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
- **Dropbox sync (bring your own Dropbox app)** — create a free Dropbox app, configure it once, then click the ☁ button to connect your own Dropbox account; your tasks sync automatically across all your PCs (see [Dropbox sync](#dropbox-sync) below)
- **System tray** — minimizes to the tray instead of closing; auto-starts with Windows
- **Always-on-top toggle** — pin it above other windows when you want it, or let it sit normally otherwise
- **Rounded, transparent widget window** — anchored to the top-right corner of your screen, click-through outside its edges

## Dropbox sync

Nook keeps your tasks in one JSON file and syncs it to your own Dropbox, so they follow you between PCs.

**Anyone can use this with their own Dropbox.** The Dropbox login is tied to a Dropbox *app* (a free, one-time setup of about 5 minutes, see [Setting up your own Dropbox app](#setting-up-your-own-dropbox-app) below). Create your own, point Nook at it, and connect your account. Your tasks are stored only in your own Dropbox, and no one else, including the author, can see them.

- **Connect:** click the ☁ button in the widget. Your browser opens Dropbox; click **Allow** and you're done. The ☁ turns blue while connected.
- **Disconnect:** click the blue ☁ and choose **Disconnect** in the small popup. Your tasks stay on the PC; they just stop syncing. (Both actions are also in the tray menu.)
- **How it syncs:** every change is uploaded about 2 seconds after you make it, and Nook checks Dropbox for changes every minute. If both sides changed, the most recently modified copy wins.
- **Where it lives:** `calendar-widget-tasks.json` in the Dropbox app folder (`Dropbox/Apps/<your app name>/`).
- **Login is one-time:** Nook stores a long-lived Dropbox refresh token in its own app-data folder (`%APPDATA%\Nook\config.json`). No app secret is bundled in the installer.

### Setting up your own Dropbox app

The app key in the source code belongs to the author's own Dropbox app, which is limited by Dropbox to a small number of users. To use Nook with your own Dropbox, create your own app, which is free and needs no credit card:

1. Go to [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) and click **Create app**. Choose **Scoped access → App folder** and give it any name.
2. On the **Permissions** tab, enable `files.content.read` and `files.content.write`, then click **Submit**.
3. On the **Settings** tab, under **Redirect URIs**, add exactly `http://localhost:53682/callback` and click **Add**. Make sure **Allow public clients (Implicit Grant & PKCE)** is set to **Allow**.
4. Copy the **App key** from the same page (the app secret is not needed).
5. Tell Nook your key, either way:
   - edit the `DROPBOX_APP_KEY` default in `main.js` and rebuild the installer, or
   - set a `DROPBOX_APP_KEY` environment variable (Windows: Settings → search "environment variables") and restart Nook.
6. Start Nook, click the ☁ button, and approve the connection in your browser.

Your app starts in Dropbox's "development" status, which is fine for personal use and a few of your own accounts.

When running from source you can optionally skip the ☁ login by creating a git-ignored `.env` file next to `main.js`:

```
DROPBOX_APP_KEY=...
DROPBOX_APP_SECRET=...
DROPBOX_REFRESH_TOKEN=...
```

`.env` is never packaged into the installer. Do not commit it.

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
>
> **Tip:** if `ELECTRON_RUN_AS_NODE` is set in your shell, `npm start` fails with `Cannot read properties of undefined (reading 'setName')`. Clear it first (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`).

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- Vanilla HTML/CSS/JS — no frameworks, no build step for the app itself
- [electron-builder](https://www.electron.build/) — packaging

## Project structure

```
main.js        Electron main process — window, tray, file I/O, Dropbox sync, notifications
preload.js     Context-isolated bridge between main and renderer
renderer.js    All UI logic — calendar, agenda, tasks, reminders
index.html     App markup
styles.css     App styling
icon.ico       App/window/tray icon
```

## License

MIT — see [LICENSE](LICENSE).
