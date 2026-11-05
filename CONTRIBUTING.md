# Contributing to AetherDeck

Thanks for helping. AetherDeck is built in the open, and every kind of contribution counts: bug reports, ideas,
docs, design, translations and code.

## Ways to help

- **Report a bug** or **suggest a feature** with the [issue forms](https://github.com/tajwarah/aetherdeck/issues/new/choose).
- **Ask or share** in [Discussions](https://github.com/tajwarah/aetherdeck/discussions): questions, show-and-tell, agent recipes.
- **Pick an issue** labeled [`good first issue`](https://github.com/tajwarah/aetherdeck/labels/good%20first%20issue) or [`help wanted`](https://github.com/tajwarah/aetherdeck/labels/help%20wanted).
- **Improve the docs**: the README, [docs/GUIDE.md](docs/GUIDE.md) and [docs/DESIGN.md](docs/DESIGN.md).

## Set up

```bash
git clone https://github.com/tajwarah/aetherdeck.git && cd aetherdeck
npm install
npm run desktop:dev        # the desktop app with live reload
```

Node 22 or newer. For AI features in development, copy `.env.example` to `.env` and add a key. `.env` is ignored by git;
never commit keys.

## Before you open a pull request

```bash
npm run typecheck
npm test                   # unit tests
npm run test:e2e           # end-to-end tests (first time: npx playwright install --only-shell chromium)
```

- Keep a pull request to one change, and describe what it changes for the person using AetherDeck.
- Add or update tests for behaviour you change.
- Match the code around you: comments say why, names say what, and there's no UI framework beyond React.
- User-facing text is plain and direct. Say what happens, not how clever it is.
- Anything that acts in the world (posting, sending, buying, signing in) must wait for the person's approval. Agents
  never type passwords and never get around a CAPTCHA. Pull requests that weaken this won't be merged.

## Design

The look, motion and honesty rules are in [docs/DESIGN.md](docs/DESIGN.md). For a visible change, include a
before-and-after screenshot.

## License of contributions

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), like the rest of
AetherDeck.
