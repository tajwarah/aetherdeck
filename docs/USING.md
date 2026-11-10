# Using AetherDeck

A short guide to getting set up and finding your way around. For how it's built, see the [technical guide](GUIDE.md).

## 1. First launch

Install AetherDeck from the [Releases](https://github.com/tajwarah/aetherdeck/releases/latest) page. It isn't code-signed yet, so the first time:

- **Windows:** if SmartScreen says "Windows protected your PC", press **More info → Run anyway**.
- **Mac:** open it once, then **System Settings → Privacy & Security → Open Anyway**.

A one-minute setup opens. Every step can be skipped and changed later in **Settings** (the ⚙️ at the top, or Ctrl/Cmd + ,).

## 2. Give AetherDeck an AI

The AI writes research answers, powers Cosmonaut and runs your agents. Pick **one** of these in Settings → AI:

| Option | Best for | How |
|---|---|---|
| **A free key** (Gemini, Groq, OpenRouter) | Trying it out | Create a key on the provider's site, paste it in Settings → AI, press **Connect**. Gemini's free tier is the easiest start |
| **Your ChatGPT plan** (Plus or Pro) | People who already pay for ChatGPT | Press **Sign in with ChatGPT** (see below) |
| **A paid key** (OpenAI, Anthropic) | Heavy use | Paste the key and press **Connect** |
| **Ollama or LM Studio** | Free and fully private | Install Ollama, run `ollama pull qwen3`, pick Ollama in Settings |

Keys are encrypted by your system keychain and sent only to the provider they belong to. Without any AI, research still works: answers are quoted word for word from the sources.

## 3. Sign-ins

AetherDeck has four kinds of sign-in. None of them gives AetherDeck your password.

### ChatGPT (to use your plan)

1. Settings → AI → **Sign in with ChatGPT**.
2. ChatGPT's sign-in opens in a browser. If AetherDeck is your default browser, it opens in **Microsoft Edge** on Windows or **Safari** on Mac instead, because Google refuses its own sign-in inside AetherDeck (see below).
3. Sign in, approve AetherDeck, and set how much of your plan it may use.
4. The page says "Signed in". Come back to AetherDeck. Settings shows "Signed in as …".

If no browser opened, or you'd rather use another one, press **Copy the sign-in link** in Settings and paste it into any browser on the same computer. **Cancel** stops waiting.

If it says your plan can't be used in other apps, the plan needs to be Plus or Pro. Use a key instead.

### Google (for agents)

Google refuses to let you sign in inside AetherDeck's pages, so agents can't use Drive or Calendar through the websites. Instead, AetherDeck can sign in the way desktop apps do: you approve it on Google's own page in your browser, and it keeps a refresh token encrypted by your system keychain. You use **your own** Google client ID, so nothing is built in and no one else is involved. This lets an agent with the **Google** power save files to your Drive, read back files it saved, and add or list Calendar events. It never reads Gmail (Gmail access needs a Google security review, so AetherDeck doesn't ask for it) and only reaches Drive files AetherDeck created. YouTube upload permission is requested too, for a later release.

**Make a client ID (about five minutes, free):**

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name).
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): choose **External**, fill in an app name and your email, and under **Audience** add your own Google address as a **test user**. Leave it in *Testing*; as the only user you don't need Google's review. Note that in Testing mode Google expires the sign-in after 7 days, so you will be asked to sign in again weekly.
4. **Clients → Create client**: type **Desktop app**. Copy the **Client ID**. If Google shows a **Client secret**, copy it too. For desktop apps it isn't truly secret.
5. In AetherDeck: Settings → AI → **Google for agents**, paste the client ID (and secret), press **Save**, then **Sign in with Google**. Approve all the permissions. Settings shows "Signed in as …".

**Sign out** revokes the permission at Google. **Copy the sign-in link** and **Cancel** work like ChatGPT's. Then switch on **Google** for an agent in the Agent Station. Access "Read only" agents can list and read but not save or add.

### Websites (YouTube, Gmail, Facebook, Instagram, X, LinkedIn, Notion, Canva…)

You sign in on the site's own page, in an AetherDeck tab, exactly as in any browser. Agents use these sign-ins to read and post, and they ask you before anything goes out.

**Google (YouTube, Gmail, Docs) may refuse.** Google sometimes shows *"Couldn't sign you in. This browser or app may not be secure"* for browsers built on Electron, like AetherDeck. This has been seen on Windows. Until there's a fix:

- Everything else works without Google: research, agents, other sites, and YouTube without signing in.
- On the ChatGPT sign-in page, use **email and password** rather than "Continue with Google".
- Pick Bing or DuckDuckGo in Settings → Search if Google search shows a "not a robot" check.

### Your AI provider's account

Provider websites (Google AI Studio, OpenAI, Anthropic) are only for creating keys. You sign in there in any browser, create a key, and paste the key into AetherDeck.

## 4. Everyday use

| To | Do |
|---|---|
| Ask or search | Click anywhere on the home, or press `/`. Type a question, an address, or "play …". Or press the 🎤 |
| Read an answer | The answer sits in the middle. Point at a sentence to light up its sources. Click a site to open it |
| Open every source | **Open all as tabs** at the bottom of the map |
| Find past research | **Research** in the dock. Search, reopen, group, or connect searches and ask about them together |
| Ask about a page or file | **AI** in the dock (Cosmonaut). Drop in a PDF, document, spreadsheet or image |
| See every tab around you | The **360°** button, or Ctrl/Cmd + Shift + U |
| Give an agent a task | **Agents** in the dock → type the task → **Deploy**. Approve posts and sends from the board |
| Block ads and trackers | On by default. The 🛡 in the address bar turns Shields off for one site |
| Change anything from setup | Settings → General → **Run setup again** |

## 5. When something goes wrong

| Problem | Fix |
|---|---|
| "No AI connected" | Settings → AI: connect a key or sign in with ChatGPT |
| Research shows a "not a robot" check | Answer it in its window, or switch to Bing or DuckDuckGo in Settings → Search |
| ChatGPT sign-in waits forever | Press **Cancel**, then **Sign in with ChatGPT** again and use **Copy the sign-in link** |
| Google says "Couldn't sign you in" | See *Google may refuse* above |
| Netflix or Spotify won't play | Not supported yet: they need Widevine |

Still stuck? [Open an issue](https://github.com/tajwarah/aetherdeck/issues/new/choose) with your system (Windows, Mac or Linux) and what you saw.
