#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const inquirer = require('inquirer');
const simpleGit = require('simple-git');
const chrono = require('chrono-node');

async function ensureGitRepository(gitInstance) {
  try {
    await gitInstance.revparse(["--is-inside-work-tree"]);
    return true;
  } catch (e) {
    return false;
  }
}

async function selectByCommits(gitInstance) {
  const log = await gitInstance.log({ maxCount: 100 });
  if (!log.all.length) {
    throw new Error('No commits found.');
  }
  const choices = log.all.map((entry) => ({
    name: `${entry.hash.slice(0, 7)}  ${new Date(entry.date).toISOString().slice(0,10)}  ${entry.message}`,
    value: entry.hash
  }));

  const { from } = await inquirer.prompt([
    { type: 'list', name: 'from', message: 'Select the older commit (FROM):', pageSize: 15, choices }
  ]);
  const { to } = await inquirer.prompt([
    { type: 'list', name: 'to', message: 'Select the newer commit (TO):', pageSize: 15, choices }
  ]);

  if (from === to) {
    throw new Error('FROM and TO commits cannot be the same.');
  }

  // Ensure correct order (from older to newer)
  const order = execSync(`git rev-list --ancestry-path ${from}..${to} | wc -l`).toString().trim();
  if (order === '0') {
    // If not ancestor path, we still attempt diff as a generic range
    return { from, to };
  }
  return { from, to };
}

async function selectByTags(gitInstance) {
  const raw = execSync('git for-each-ref --sort=-creatordate --format "%(refname:short) | %(creatordate:short) | %(subject)" refs/tags', { stdio: ['ignore','pipe','ignore'] }).toString();
  const lines = raw.split('\n').filter(Boolean);
  if (!lines.length) {
    throw new Error('No tags found.');
  }
  const tagChoices = lines.map(line => {
    const [tag] = line.split(' | ');
    return { name: line, value: tag };
  });
  const { fromTag } = await inquirer.prompt([
    { type: 'list', name: 'fromTag', message: 'Select the older release (FROM):', pageSize: 15, choices: tagChoices }
  ]);
  const { toTag } = await inquirer.prompt([
    { type: 'list', name: 'toTag', message: 'Select the newer release (TO):', pageSize: 15, choices: tagChoices }
  ]);
  if (fromTag === toTag) {
    throw new Error('FROM and TO tags cannot be the same.');
  }
  return { from: fromTag, to: toTag };
}

async function selectByTimeRange(gitInstance) {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'start', message: 'Enter start date/time (e.g., "2024-05-01" or "last Monday 9am"): ' },
    { type: 'input', name: 'end', message: 'Enter end date/time (e.g., "2024-06-01" or "yesterday 5pm"): ' }
  ]);
  let startParsed = chrono.parseDate(answers.start);
  let endParsed = chrono.parseDate(answers.end);
  if (!startParsed || !endParsed) {
    throw new Error('Could not parse dates. Please try again with clearer input.');
  }
  if (startParsed > endParsed) {
    const tmp = startParsed;
    startParsed = endParsed;
    endParsed = tmp;
  }
  const startISO = startParsed.toISOString();
  const endISO = endParsed.toISOString();

  // Identify boundary commits around the time range
  const to = execSync(`git rev-list -1 --before='${endISO}' HEAD`, { stdio: ['ignore','pipe','ignore'] }).toString().trim();
  const baseBeforeStart = execSync(`git rev-list -1 --before='${startISO}' HEAD`, { stdio: ['ignore','pipe','ignore'] }).toString().trim();
  if (!to || !baseBeforeStart) {
    throw new Error('Could not find commits for the given time range.');
  }
  return { from: baseBeforeStart, to };
}

function collectGitHistoryText(range) {
  const { from, to } = range;
  const logFormat = '%h%x09%an%x09%ad%x09%s%x0a%b';
  const logText = execSync(`git log ${from}..${to} --date=iso --pretty=format:"${logFormat}"`, { stdio: ['ignore','pipe','ignore'] }).toString();
  const filesText = execSync(`git diff --name-status ${from}..${to}`, { stdio: ['ignore','pipe','ignore'] }).toString();
  const statsText = execSync(`git diff --stat ${from}..${to}`, { stdio: ['ignore','pipe','ignore'] }).toString();
  const summary = [
    '# Git History',
    '',
    '## Commit Log',
    logText.trim() || '(No commits)',
    '',
    '## Changed Files (name-status)',
    filesText.trim() || '(No file changes)',
    '',
    '## Diff Stats',
    statsText.trim() || '(No stats)'
  ].join('\n');
  return summary;
}

async function callAzureOpenAI(historyMarkdown) {
  const apiKey = process.env.OPENAI_API_KEY;
  let key = apiKey;
  if (!key) {
    const a = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: 'Enter OPENAI_API_KEY:', mask: '*' }
    ]);
    key = a.apiKey;
  }
  if (!key) {
    throw new Error('OPENAI_API_KEY is required.');
  }

  const basePrompt = [
    '[INSTRUCTIONS]',  
    'Task: Generate a changelog entry from the Git history. The response should strictly follow the structure below. Use only the information from the Git history.',  
    '',  
    'Output rules:',  
    '- Output ONLY valid Markdown (no code block markers).',  
    '- The structure must follow exactly this format:',  
    '',  
    '# <Heading summarizing the change>',  
    '(Heading should be short and clear, e.g., "Adds Payout Details embedded component to the Account")',  
    '',  
    '## What’s new',  
    '<Brief description of what’s newly introduced. Focus on new functionality, not internal details.>',  
    '',  
    '## Impact',  
    '<Explain the practical effect on users, developers, or systems. Answer “why this matters.”>',  
    '',  
    '## Changes',  
    '<List the most essential code changes, snippets, or file modifications very concisely. Avoid unnecessary detail.>',  
    'List all the files which are changes and what changes were made',
    'Please give code snippets here, difference between the files, the markdown file should be as descriptive as possible',
    '---',  
    'Git History:',  
    historyMarkdown  
  ].join('\n');
  
// Option 1 (Default): gpt-4o-mini hosted on my own azure server, API key shared on DM (https://x.com/whynesspower)
  const endpoint = 'https://salesassist.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-02-15-preview';

// Option 2: Regular openai chat completion endpoint
  // const endpoint = 'https://api.openai.com/v1/chat/completions';

  const payload = {
    messages: [
      { role: 'user', content: basePrompt }
    ],
    temperature: 0.2,
    max_tokens: 1200
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': key
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure OpenAI error: ${res.status} ${res.statusText} - ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content.trim()) {
    throw new Error('Received empty content from the model.');
  }
  return content;
}

function createDocsifySite(rootDir, markdownContent) {
  const siteDir = path.join(rootDir, '.diffgen_site');
  if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir);
  const readmePath = path.join(siteDir, 'README.md');
  fs.writeFileSync(readmePath, markdownContent, 'utf8');
  const indexHtmlPath = path.join(siteDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    const html = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8" />',
      '  <meta http-equiv="X-UA-Compatible" content="IE=edge" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '  <title>Changelog</title>',
      '  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css" />',
      '</head>',
      '<body>',
      '  <div id="app"></div>',
      '  <script>',
      '    window.$docsify = { name: "Changelog", loadSidebar: false, subMaxLevel: 2 };',
      '  </script>',
      '  <script src="//cdn.jsdelivr.net/npm/docsify@4"></script>',
      '</body>',
      '</html>'
    ].join('\n');
    fs.writeFileSync(indexHtmlPath, html, 'utf8');
  }
  return siteDir;
}

function resolveDocsifyBin() {
  const isWin = process.platform === 'win32';
  const cmdName = isWin ? 'docsify.cmd' : 'docsify';

  const candidates = [
    // Prefer the CLI's own bundled binary
    path.join(__dirname, '..', 'node_modules', '.bin', cmdName),
    path.join(__dirname, '..', 'node_modules', 'docsify-cli', 'bin', 'docsify'),
    // Fallback: current working directory's local install (if user installed there)
    path.join(process.cwd(), 'node_modules', '.bin', cmdName)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function serveDocsify(siteDir, port = 3000) {
  const resolved = resolveDocsifyBin();
  const args = ['serve', siteDir, '-p', String(port)];
  let child;
  if (resolved) {
    child = spawn(resolved, args, { stdio: 'inherit' });
  } else {
    // Last resort: rely on global docsify in PATH
    child = spawn('docsify', args, { stdio: 'inherit' });
  }
  child.on('error', (err) => {
    console.error('Failed to start docsify serve:', err.message);
    console.error('Tip: install globally with "npm i -g docsify-cli" or run:\n  npx docsify-cli serve', siteDir, '-p', String(port));
  });
  console.log(`\nServing changelog at http://localhost:${port} (press Ctrl+C to stop)\n`);
}

async function main() {
  const git = simpleGit({ baseDir: process.cwd() });
  const inside = await ensureGitRepository(git);
  if (!inside) {
    console.error('This tool must be run inside a Git repository.');
    process.exit(1);
  }
  const repoRoot = execSync('git rev-parse --show-toplevel', { stdio: ['ignore','pipe','ignore'] }).toString().trim();

  const { mode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'What would you like to generate?',
      choices: [
        { name: 'Generate change log between different versions', value: 'tags' },
        { name: 'Generate change log between different commits', value: 'commits' },
        { name: 'Generate change log between a time interval', value: 'time' }
      ]
    }
  ]);

  let range;
  if (mode === 'tags') {
    range = await selectByTags(git);
  } else if (mode === 'commits') {
    range = await selectByCommits(git);
  } else {
    range = await selectByTimeRange(git);
  }

  const historyMarkdown = collectGitHistoryText(range);
  const changelogMarkdown = await callAzureOpenAI(historyMarkdown);

  const outPath = path.join(repoRoot, 'CHANGELOG.generated.md');
  fs.writeFileSync(outPath, changelogMarkdown, 'utf8');
  console.log(`\nChangelog written to: ${outPath}`);

  const siteDir = createDocsifySite(repoRoot, changelogMarkdown);
  serveDocsify(siteDir, 3000);
}

// Ensure fetch exists (Node >=18)
if (typeof fetch !== 'function') {
  global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});


