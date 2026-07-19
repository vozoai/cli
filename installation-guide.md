# Vozo CLI installation guide

The following steps are designed for AI Agents. Sign-in requires user interaction in the browser.

## Prerequisites

Before starting the installation, ensure the following are installed in your environment:

- Node.js (npm / npx)

## Step 1: Install

```shell
# Install CLI + agent skills (recommended)
npx @vozoai/cli@latest install

# Verify
vozo-cli --version
```

This installs the CLI from npm (`@vozoai/cli`) and agent skills from GitHub (`npx skills add vozoai/cli -g`).

**Manual alternative:**

```shell
npm install -g @vozoai/cli
npx skills add vozoai/cli -g -y
```

If GitHub skills install fails, fall back to:

```shell
vozo-cli skills install
```

## Step 2: Login

Agent: run the following command, wait for it to finish, and help the user complete sign-in in the browser.

```shell
vozo-cli auth login --timeout-seconds 600
```

Notes for Agents:

- Set your shell-tool timeout to at least 600 seconds for this command.
- If the browser does not open, extract the `loginUrl` from stderr (`Open this login URL if the browser did not launch:`) and send it to the user.
- Only if your tool runner cannot hold a long-running command: use `vozo-cli auth login --background`, then poll `vozo-cli auth wait --timeout-seconds 30` until authenticated.

## Step 3: Verify

```shell
vozo-cli auth status
```

Optional quota checks before creating projects:

```shell
vozo-cli auth points
vozo-cli auth membership
```

## Step 4: Prefer these skills

After install, prefer the bundled agent skills over inventing ad-hoc CLI usage:

- `vozo-auth` — sign-in, logout, points, membership
- `vozo-project` — list, create, export, download

For full command reference, see [README.md](./README.md).
