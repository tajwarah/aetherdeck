# Security

AetherDeck is a free, open-source shell: you connect your own AI model, and your data stays between your computer and the services you choose. There is no AetherDeck account, no AetherDeck server and no telemetry. This file describes what protects you and what doesn't yet.

## Where your data goes

| Data | Where it stays | What leaves your computer |
|---|---|---|
| History, bookmarks, agents, research board | JSON files in the app's data folder | Nothing |
| API keys | Encrypted by the system keychain. Without a keychain they last until you quit and never reach the disk | Sent only to that key's provider |
| Pages, email or files an agent or summary reads | On this computer | With a model on your computer (Ollama, LM Studio), nothing. A model marked as running in Ollama's cloud is not local. Otherwise the text goes to the AI provider you connected, under your own key, and their terms decide how long they keep it |
| Search questions | On this computer | Goes to the search engine you chose, and to the open sources used for the map |
| Synced windows | Encrypted in the app, AES-256-GCM, with the key only in your link | Encrypted data only, to the sync server you run |

A personal install needs no database: each kind of data is one small file, written atomically. These files aren't encrypted by the app, so turn on full-disk encryption (FileVault, BitLocker or LUKS).

## What protects you

- Web pages run sandboxed, with no preload, no Node.js and context isolation on.
- The interface reaches the app only through a fixed list of requests, under a content security policy that blocks scripts it didn't ship with.
- The built-in server listens on 127.0.0.1 and requires a token created at each launch.
- Agents can't sign in, enter passwords or card numbers, buy, send email, or solve CAPTCHAs. Password and payment fields are refused in code.
- After an agent reads email, anything that could carry data out needs your approval.
- Apps built by agents run with no network and can't leave their own page.
- Text from pages and email is marked as material for the model, never as instructions. This lowers prompt injection risk but can't remove it, and smaller models resist it less, so keep approvals on for agents that read private data.
- Packaged builds turn off Electron's run-as-Node mode, `NODE_OPTIONS` and debug flags, encrypt cookies, and check the app archive's integrity.

## What isn't done yet

- Builds aren't code-signed, so you can't yet verify who built a download. Windows and Linux updates need signing before they can be fully trusted.
- There has been no independent security audit.
- Google may refuse sign-in in apps built on Electron.

## Reporting a problem

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on this repository, not in a public issue.
