#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(PACKAGE_ROOT, 'skills');

function listBundledSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      dir: path.join(SKILLS_DIR, entry.name),
    }))
    .filter(skill => fs.existsSync(path.join(skill.dir, 'SKILL.md')));
}

function getInstallTargets(target) {
  const home = os.homedir();
  const targets = [];

  if (target === 'cursor' || target === 'all') {
    const agentRootDir = path.join(home, '.cursor');
    targets.push({
      target: 'cursor',
      agentRootDir,
      skillsDir: path.join(agentRootDir, 'skills'),
    });
  }
  if (target === 'codex' || target === 'all') {
    const agentRootDir = path.join(home, '.codex');
    targets.push({
      target: 'codex',
      agentRootDir,
      skillsDir: path.join(agentRootDir, 'skills'),
    });
  }
  if (target === 'claude-code' || target === 'all') {
    const agentRootDir = path.join(home, '.claude');
    targets.push({
      target: 'claude-code',
      agentRootDir,
      skillsDir: path.join(agentRootDir, 'skills'),
    });
  }
  if (target === 'workbuddy' || target === 'all') {
    const agentRootDir =
      process.env.WORKBUDDY_CONFIG_DIR?.trim() ||
      path.join(home, '.workbuddy');
    targets.push({
      target: 'workbuddy',
      agentRootDir,
      skillsDir: path.join(agentRootDir, 'skills'),
    });
  }
  // Open Agent Skills global dir used by `npx skills add` and compatible agents.
  if (target === 'agents' || target === 'all') {
    const agentRootDir = path.join(home, '.agents');
    targets.push({
      target: 'agents',
      agentRootDir,
      skillsDir: path.join(agentRootDir, 'skills'),
    });
  }

  return targets;
}

// Only install into agents that are actually present: creating ~/.cursor & co.
// for agents the user never installed would litter the home directory and make
// those agents appear configured.
function getTargetDirs(target) {
  const candidates = getInstallTargets(target);
  const present = candidates.filter(candidate =>
    fs.existsSync(candidate.agentRootDir),
  );

  for (const candidate of candidates) {
    if (!present.includes(candidate)) {
      console.error(
        `Skipped ${candidate.target}: ${candidate.agentRootDir} not found; agent does not appear to be installed`,
      );
    }
  }

  return present.map(candidate => candidate.skillsDir);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function installSkill(skill, targetDir, link) {
  fs.mkdirSync(targetDir, { recursive: true });
  const dest = path.join(targetDir, skill.name);

  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  if (link) {
    fs.symlinkSync(skill.dir, dest, 'dir');
  } else {
    copyDirRecursive(skill.dir, dest);
  }

  return dest;
}

function parseArgs(argv) {
  const options = {
    target: 'all',
    skills: [],
    link: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--target') {
      options.target = argv[i + 1] ?? 'all';
      i += 1;
      continue;
    }
    if (arg === '--skill') {
      options.skills.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--link') {
      options.link = true;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const bundled = listBundledSkills();

  if (bundled.length === 0) {
    console.error(`No bundled skills found under ${SKILLS_DIR}`);
    process.exit(1);
  }

  const selected =
    options.skills.length > 0
      ? bundled.filter(skill => options.skills.includes(skill.name))
      : bundled;

  const targetDirs = getTargetDirs(options.target);

  if (targetDirs.length === 0) {
    console.error(
      'No supported agent directories were found (~/.cursor, ~/.codex, ~/.claude, ~/.workbuddy, ~/.agents). Install an agent first.',
    );
    process.exit(1);
  }

  for (const skill of selected) {
    for (const targetDir of targetDirs) {
      const dest = installSkill(skill, targetDir, options.link);
      console.log(`Installed ${skill.name} -> ${dest}`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  copyDirRecursive,
  getTargetDirs,
  listBundledSkills,
};
