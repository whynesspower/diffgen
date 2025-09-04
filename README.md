# Diffgen CLI

Interactive CLI that generates a clean, Markdown changelog from your Git history using Azure OpenAI, then serves it beautifully with Docsify on port 3000.

## Features
- **Interactive prompts** to choose one of:
  - Generate changelog between different versions (Git tags)
  - Generate changelog between different commits
  - Generate changelog between a time interval (natural language supported)
- **Azure OpenAI** call guided by a strict base prompt
- Saves output to `CHANGELOG.generated.md` at the repo root
- **Docsify** site auto-generated and served at `http://localhost:3000`

## Quick start on a new macOS machine
### Warning! Before running the code, please see the endpoint link in the diffgen.js file
Make it point to regular openai chat completion endpoint or you can use the chat completion endpoint of my custom deployment

1) Install Homebrew (if not already):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2) Install Git and Node (use nvm for Node 18+):
```bash
brew install git
brew install nvm
mkdir -p ~/.nvm && echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc && echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc && source ~/.zshrc
nvm install 18
nvm use 18
node -v && npm -v
```

3) Clone this repo and set up the CLI (global link):
```bash
cd /Users/$(whoami)/Desktop
git clone https://github.com/whynesspower/diffgen.git
cd diffgen/cli
npm install
npm link
```
This exposes a global command named `diffgen` on your machine.

4) Configure your API key (Azure OpenAI):
```bash
export OPENAI_API_KEY="<your-openai-api-key>"
```
- You can add the export to `~/.zshrc` to persist it across terminals.
- The CLI will prompt for the key if it is not set.

## Using the CLI from any Git repository

1) Open any Git repository (not this CLI folder):
```bash
cd /path/to/another-git-project
```

2) Run the tool:
```bash
diffgen
```

3) Choose your generation mode when prompted:
- Generate change log between different versions (tags)
- Generate change log between different commits
- Generate change log between a time interval

4) Follow the prompts to select the range. The tool will:
- Collect Git history between your selections
- Call Azure OpenAI and generate Markdown
- Save `CHANGELOG.generated.md` at the repo root
- Serve a Docsify site at `http://localhost:3000`

Open your browser to `http://localhost:3000` to view the changelog.

## Verifying installation
- Ensure `diffgen` is on PATH:
```bash
which diffgen
```
- If it doesn’t show a path under your `diffgen/cli` folder, re-run in the CLI folder:
```bash
npm install
npm link
```

## Troubleshooting
- **This tool must be run inside a Git repository**:
  - Run `diffgen` from a folder that contains a `.git` directory.
- **spawn docsify ENOENT** (docsify not found):
  - In `diffgen/cli`, run `npm install` then `npm link` again. The CLI resolves its bundled `docsify-cli` binary first.
  - As a fallback, run: `npx docsify-cli serve /path/to/repo/.diffgen_site -p 3000` or install globally: `npm i -g docsify-cli`.
- **Port 3000 already in use**:
  - Stop the process using it, or change the port in the CLI if needed.
- **Empty or unexpected output**:
  - Ensure there are meaningful commits/changes between your selected range.
  - Verify `OPENAI_API_KEY` is set and valid for your Azure OpenAI deployment.

## Local development (optional)
Run directly from this folder without linking:
```bash
npm install
npm run start
# or
node bin/diffgen.js
```

## Uninstall (global link)
To remove the global link:
```bash
npm unlink -g diffgen-cli
```
