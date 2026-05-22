#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import tls from 'tls';
import crypto from 'crypto';
import os from 'os';
import { spawn, execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

// Default config path: ~/.config/forticlient/config.json
let CONFIG_PATH = path.resolve(os.homedir(), '.config/forticlient/config.json');

// Parse --config or -c override
const configIndex = process.argv.findIndex(arg => arg === '--config' || arg === '-c');
if (configIndex !== -1 && process.argv[configIndex + 1]) {
  CONFIG_PATH = path.resolve(process.argv[configIndex + 1]);
  process.argv.splice(configIndex, 2);
}

// Check if openfortivpn is installed
function isBinaryInstalled(binary) {
  try {
    execSync(`which ${binary}`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Format fingerprint to a continuous hex string
function cleanFingerprint(fp) {
  if (!fp) return '';
  return fp.replace(/[:\s-]/g, '').toLowerCase();
}

// Fetch SSL/TLS Certificate fingerprint from the gateway
function fetchCertFingerprint(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      rejectUnauthorized: false, // Inspect untrusted certs
      servername: host
    });

    socket.setTimeout(8000); // 8 second timeout

    socket.on('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();
      if (cert && cert.raw) {
        const hash = crypto.createHash('sha256').update(cert.raw).digest('hex');
        resolve(hash);
      } else {
        reject(new Error('Failed to retrieve peer certificate.'));
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timed out while fetching certificate.'));
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

// Load configurations
function loadConfig() {
  const configDir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = { connections: [] };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error(chalk.red(`\n❌ Error reading configuration file (${CONFIG_PATH}): ${e.message}`));
    console.log(chalk.yellow('Using empty configuration.'));
    return { connections: [] };
  }
}

// Save configurations
function saveConfig(config) {
  try {
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error(chalk.red(`\n❌ Failed to save configuration file (${CONFIG_PATH}): ${e.message}`));
    return false;
  }
}

// Print title banner
function printBanner() {
  console.clear();
  console.log(chalk.cyan(`
┌────────────────────────────────────────────────────────┐
│  🛡️  ${chalk.bold('FortiClient CLI')} - Open Source SSL VPN Manager   │
└────────────────────────────────────────────────────────┘
  `));
}

// Main interactive menu loop
async function mainMenu() {
  while (true) {
    printBanner();
    const config = loadConfig();
    const count = config.connections ? config.connections.length : 0;
    console.log(chalk.gray(` Loaded ${count} profile(s) from: ${CONFIG_PATH}\n`));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '🔌 Connect to a VPN', value: 'connect' },
          { name: '➕ Add Connection', value: 'add' },
          { name: '✏️  Edit Connection', value: 'edit' },
          { name: '🗑️  Delete Connection', value: 'delete' },
          { name: '⚙️  Check Dependencies', value: 'deps' },
          { name: '❌ Exit', value: 'exit' }
        ]
      }
    ]);

    if (action === 'exit') {
      console.log(chalk.green('\nGoodbye! 👋'));
      process.exit(0);
    }

    try {
      switch (action) {
        case 'connect':
          await handleConnect(config);
          break;
        case 'add':
          await handleAdd(config);
          break;
        case 'edit':
          await handleEdit(config);
          break;
        case 'delete':
          await handleDelete(config);
          break;
        case 'deps':
          await handleCheckDeps();
          break;
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err.message}`));
      await pause();
    }
  }
}

// Helper to pause execution until user presses Enter
function pause() {
  return inquirer.prompt([
    {
      type: 'input',
      name: 'temp',
      message: 'Press Enter to continue...'
    }
  ]);
}

// Handle Check Dependencies
async function handleCheckDeps() {
  console.log(chalk.bold('\n🔍 Checking system dependencies...'));
  
  const hasOpenForti = isBinaryInstalled('openfortivpn');
  const hasPppd = isBinaryInstalled('pppd');

  console.log(`- openfortivpn: ${hasOpenForti ? chalk.green('✔ Installed') : chalk.red('✘ Not Installed')}`);
  console.log(`- pppd (PPP daemon): ${hasPppd ? chalk.green('✔ Installed') : chalk.red('✘ Not Installed')}`);

  if (!hasOpenForti) {
    console.log(chalk.yellow('\nℹ openfortivpn is required. You can install it on Ubuntu/Debian using:'));
    console.log(chalk.cyan('  sudo apt update && sudo apt install openfortivpn'));
    
    const { install } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'install',
        message: 'Would you like to try installing openfortivpn now?',
        default: true
      }
    ]);

    if (install) {
      const spinner = ora('Installing openfortivpn...').start();
      try {
        execSync('sudo apt-get update && sudo apt-get install -y openfortivpn', { stdio: 'inherit' });
        spinner.succeed('openfortivpn installed successfully!');
      } catch (e) {
        spinner.fail(`Failed to install openfortivpn: ${e.message}`);
      }
    }
  }

  if (!hasPppd) {
    console.log(chalk.yellow('\nℹ pppd is required by openfortivpn. You can install it using:'));
    console.log(chalk.cyan('  sudo apt install ppp'));
  }

  console.log('');
  await pause();
}

// Establish connection to a specific profile
async function connectToProfile(conn, config) {
  // Check openfortivpn binary
  if (!isBinaryInstalled('openfortivpn')) {
    console.log(chalk.red('\n❌ openfortivpn is not installed. Go back to main menu and check dependencies.'));
    return;
  }

  // Resolve gateway & port
  let gateway = conn.gateway;
  let port = conn.port || 443;

  if (conn.gateways && conn.gateways.length > 0) {
    if (conn.gateways.length === 1) {
      gateway = conn.gateways[0].host;
      port = conn.gateways[0].port || 443;
    } else {
      // Prompt user to select gateway from lists
      const { selectedGw } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedGw',
          message: 'Select gateway to connect to:',
          choices: conn.gateways.map(g => ({
            name: `${g.host}:${g.port || 443}`,
            value: g
          }))
        }
      ]);
      gateway = selectedGw.host;
      port = selectedGw.port || 443;
    }
  }

  if (!gateway) {
    console.log(chalk.red('\n❌ Error: No gateway specified for this connection.'));
    return;
  }

  console.log(chalk.blue(`\n🌐 Connecting to ${chalk.bold(conn.name)} via ${gateway}:${port}...`));

  // Fetch certificate fingerprint
  const spinner = ora('Fetching gateway certificate...').start();
  let serverFingerprint = '';
  try {
    serverFingerprint = await fetchCertFingerprint(gateway, port);
    spinner.succeed(`Retrieved gateway certificate fingerprint: ${chalk.gray(serverFingerprint)}`);
  } catch (err) {
    spinner.fail(`Failed to fetch certificate: ${err.message}`);
    console.log(chalk.yellow('⚠️ Proceeding without SSL certificate verification (could result in verification failure)...'));
  }

  let trustedCert = cleanFingerprint(conn.trusted_cert);

  if (serverFingerprint) {
    if (!trustedCert) {
      console.log(chalk.yellow(`\n⚠️ No trusted certificate registered for this connection.`));
      const { trust } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'trust',
          message: `Do you want to trust the certificate ${chalk.cyan(serverFingerprint)}?`,
          default: true
        }
      ]);

      if (trust) {
        conn.trusted_cert = serverFingerprint;
        saveConfig(config);
        trustedCert = serverFingerprint;
        console.log(chalk.green('✓ Certificate saved to config.json.'));
      }
    } else if (trustedCert !== serverFingerprint) {
      console.log(chalk.red(`\n🚨 WARNING: Certificate fingerprint mismatch!`));
      console.log(`Stored fingerprint:  ${chalk.gray(trustedCert)}`);
      console.log(`Gateway fingerprint: ${chalk.cyan(serverFingerprint)}`);
      
      const { trustNew } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'trustNew',
          message: 'Do you want to trust the NEW certificate and update your config?',
          default: false
        }
      ]);

      if (trustNew) {
        conn.trusted_cert = serverFingerprint;
        saveConfig(config);
        trustedCert = serverFingerprint;
        console.log(chalk.green('✓ Config updated with new certificate.'));
      } else {
        console.log(chalk.yellow('Continuing with previously stored certificate (connection may fail if outdated).'));
      }
    }
  }

  // Create temporary config file for openfortivpn
  const tempConfigPath = path.resolve(`./.temp_openfortivpn_${Date.now()}.conf`);
  let configContent = `host = ${gateway}\nport = ${port}\nusername = ${conn.username}\n`;
  if (conn.saml) {
    const samlPort = conn.saml_port || 8020;
    configContent += `saml-login = ${samlPort}\n`;
  } else {
    configContent += `password = ${conn.password}\n`;
  }
  if (trustedCert) {
    configContent += `trusted-cert = ${trustedCert}\n`;
  }
  if (conn.realm) {
    configContent += `realm = ${conn.realm}\n`;
  }
  configContent += `set-dns = ${conn.set_dns !== false ? '1' : '0'}\n`;
  configContent += `set-routes = ${conn.set_routes !== false ? '1' : '0'}\n`;

  fs.writeFileSync(tempConfigPath, configContent, 'utf-8');

  // Register cleanups
  const cleanup = () => {
    try {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    } catch (e) {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  console.log(chalk.yellow('\n🚀 Starting openfortivpn. Sudo permissions are required.'));
  console.log(chalk.gray('Enter your local sudo password if prompted.\n'));

  // Spawn openfortivpn
  const child = spawn('sudo', ['openfortivpn', '-c', tempConfigPath], {
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    cleanup();
    process.off('exit', cleanup);
    process.off('SIGINT', cleanup);
    
    console.log(chalk.blue(`\n🔒 VPN connection closed. (Exit code: ${code})`));
  });

  // Keep CLI alive waiting for the child process to complete
  await new Promise((resolve) => {
    child.on('close', resolve);
  });
}

// Handle Connect
async function handleConnect(config) {
  if (!config.connections || config.connections.length === 0) {
    console.log(chalk.yellow('\n⚠️ No connection profiles configured yet. Please add one first!'));
    await pause();
    return;
  }

  // Choose profile
  const { profileName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'profileName',
      message: 'Select a connection profile:',
      choices: config.connections.map(c => ({
        name: `${chalk.bold(c.name)} ${c.description ? chalk.gray(`(${c.description})`) : ''}`,
        value: c.name
      }))
    }
  ]);

  const conn = config.connections.find(c => c.name === profileName);
  if (!conn) return;

  await connectToProfile(conn, config);
  await pause();
}

// Handle Add Connection
async function handleAdd(config) {
  console.log(chalk.bold('\n➕ Create a New VPN Profile\n'));

  const questions = [
    {
      type: 'input',
      name: 'name',
      message: 'Connection name (e.g. US-VPN):',
      validate: (input) => {
        if (!input.trim()) return 'Name is required.';
        if (config.connections.some(c => c.name.toLowerCase() === input.trim().toLowerCase())) {
          return 'A connection with this name already exists.';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description (optional):'
    },
    {
      type: 'list',
      name: 'gatewayType',
      message: 'How many gateways does this VPN have?',
      choices: [
        { name: 'Single Gateway', value: 'single' },
        { name: 'Multiple Gateways (Alternative servers)', value: 'multiple' }
      ]
    }
  ];

  const answers = await inquirer.prompt(questions);
  let gatewayDetails = {};

  if (answers.gatewayType === 'single') {
    const singleQuestions = [
      {
        type: 'input',
        name: 'gateway',
        message: 'Gateway host (e.g. vpn.example.com):',
        validate: (input) => input.trim() ? true : 'Gateway is required.'
      },
      {
        type: 'number',
        name: 'port',
        message: 'Port:',
        default: 443
      }
    ];
    const singleAnswers = await inquirer.prompt(singleQuestions);
    gatewayDetails = {
      gateway: singleAnswers.gateway.trim(),
      port: singleAnswers.port
    };
  } else {
    // Prompt for multiple gateways
    const gateways = [];
    let addMore = true;
    while (addMore) {
      const gwAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: `Gateway #${gateways.length + 1} host (e.g. vpn-us.example.com):`,
          validate: (input) => input.trim() ? true : 'Host is required.'
        },
        {
          type: 'number',
          name: 'port',
          message: 'Port:',
          default: 443
        },
        {
          type: 'confirm',
          name: 'more',
          message: 'Add another gateway?',
          default: false
        }
      ]);
      gateways.push({ host: gwAnswers.host.trim(), port: gwAnswers.port });
      addMore = gwAnswers.more;
    }
    gatewayDetails = { gateways };
  }

  const samlAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'saml',
      message: 'Use SAML Single Sign-On (SSO / Office365)?',
      default: false
    }
  ]);

  const credQuestions = [
    {
      type: 'input',
      name: 'username',
      message: 'VPN Username / Email:',
      validate: (input) => input.trim() ? true : 'Username is required.'
    }
  ];

  if (!samlAnswer.saml) {
    credQuestions.push({
      type: 'password',
      name: 'password',
      message: 'VPN Password:',
      mask: '*',
      validate: (input) => input ? true : 'Password is required.'
    });
  } else {
    credQuestions.push({
      type: 'number',
      name: 'saml_port',
      message: 'SAML Redirect local port:',
      default: 8020
    });
  }

  // Add the remaining questions
  credQuestions.push(
    {
      type: 'confirm',
      name: 'set_dns',
      message: 'Update DNS settings on connect (set-dns = 1)?',
      default: true
    },
    {
      type: 'confirm',
      name: 'set_routes',
      message: 'Update routing table on connect (set-routes = 1)?',
      default: true
    },
    {
      type: 'confirm',
      name: 'fetchCert',
      message: 'Attempt to auto-fetch certificate fingerprint now?',
      default: true
    }
  );

  const credentials = await inquirer.prompt(credQuestions);

  let trusted_cert = '';
  if (credentials.fetchCert) {
    const fetchHost = gatewayDetails.gateway || (gatewayDetails.gateways && gatewayDetails.gateways[0]?.host);
    const fetchPort = gatewayDetails.port || (gatewayDetails.gateways && gatewayDetails.gateways[0]?.port) || 443;
    
    if (fetchHost) {
      const spinner = ora('Fetching certificate fingerprint...').start();
      try {
        trusted_cert = await fetchCertFingerprint(fetchHost, fetchPort);
        spinner.succeed(`Successfully fetched certificate fingerprint: ${chalk.green(trusted_cert)}`);
      } catch (err) {
        spinner.fail(`Could not fetch certificate: ${err.message}`);
        console.log(chalk.yellow('You can still connect; we will ask to trust the certificate during connection.'));
      }
    }
  }

  const newConn = {
    name: answers.name.trim(),
    description: answers.description.trim(),
    ...gatewayDetails,
    username: credentials.username.trim(),
    saml: samlAnswer.saml,
    saml_port: samlAnswer.saml ? credentials.saml_port : undefined,
    password: samlAnswer.saml ? '' : credentials.password,
    trusted_cert,
    set_dns: credentials.set_dns,
    set_routes: credentials.set_routes
  };

  config.connections.push(newConn);
  if (saveConfig(config)) {
    console.log(chalk.green(`\n✓ VPN Profile "${newConn.name}" created successfully!`));
  }
  await pause();
}

// Handle Edit Connection
async function handleEdit(config) {
  if (!config.connections || config.connections.length === 0) {
    console.log(chalk.yellow('\n⚠️ No connection profiles configured yet.'));
    await pause();
    return;
  }

  const { profileName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'profileName',
      message: 'Select a connection profile to edit:',
      choices: config.connections.map(c => c.name)
    }
  ]);

  const index = config.connections.findIndex(c => c.name === profileName);
  const conn = config.connections[index];

  console.log(chalk.bold(`\n✏️ Editing Profile "${profileName}"`));
  console.log(chalk.gray('Press Enter to keep current values.\n'));

  // If it's a single gateway or multi gateway
  const editSingle = !conn.gateways || conn.gateways.length === 0;

  const basicQuestions = [
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: conn.description
    }
  ];

  if (editSingle) {
    basicQuestions.push(
      {
        type: 'input',
        name: 'gateway',
        message: 'Gateway host:',
        default: conn.gateway
      },
      {
        type: 'number',
        name: 'port',
        message: 'Port:',
        default: conn.port || 443
      }
    );
  }

  const basicAnswers = await inquirer.prompt(basicQuestions);

  let gateways = conn.gateways;
  if (!editSingle) {
    console.log(chalk.yellow(`This profile contains multiple gateways. We will edit them in sequence:`));
    gateways = [];
    for (let i = 0; i < conn.gateways.length; i++) {
      const g = conn.gateways[i];
      const gAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: `Gateway #${i + 1} host:`,
          default: g.host
        },
        {
          type: 'number',
          name: 'port',
          message: `Gateway #${i + 1} port:`,
          default: g.port || 443
        }
      ]);
      gateways.push({ host: gAnswers.host.trim(), port: gAnswers.port });
    }
  }

  const credentials = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: 'VPN Username:',
      default: conn.username
    },
    {
      type: 'input',
      name: 'realm',
      message: 'VPN Realm (optional):',
      default: conn.realm || ''
    },
    {
      type: 'confirm',
      name: 'saml',
      message: 'Use SAML Single Sign-On (SSO)?',
      default: !!conn.saml
    },
    {
      type: 'password',
      name: 'password',
      message: 'VPN Password:',
      mask: '*',
      default: conn.password || '',
      when: (answers) => !answers.saml
    },
    {
      type: 'number',
      name: 'saml_port',
      message: 'SAML Redirect local port:',
      default: conn.saml_port || 8020,
      when: (answers) => answers.saml
    },
    {
      type: 'input',
      name: 'trusted_cert',
      message: 'Trusted certificate fingerprint:',
      default: conn.trusted_cert
    },
    {
      type: 'confirm',
      name: 'set_dns',
      message: 'Update DNS settings on connect (set-dns = 1)?',
      default: conn.set_dns !== false
    },
    {
      type: 'confirm',
      name: 'set_routes',
      message: 'Update routing table on connect (set-routes = 1)?',
      default: conn.set_routes !== false
    }
  ]);

  config.connections[index] = {
    ...conn,
    description: basicAnswers.description.trim(),
    ...(editSingle ? { gateway: basicAnswers.gateway.trim(), port: basicAnswers.port } : { gateways }),
    username: credentials.username.trim(),
    realm: credentials.realm.trim(),
    saml: credentials.saml,
    saml_port: credentials.saml ? credentials.saml_port : undefined,
    password: credentials.saml ? '' : credentials.password,
    trusted_cert: cleanFingerprint(credentials.trusted_cert),
    set_dns: credentials.set_dns,
    set_routes: credentials.set_routes
  };

  if (saveConfig(config)) {
    console.log(chalk.green(`\n✓ VPN Profile "${profileName}" updated successfully!`));
  }
  await pause();
}

// Handle Delete Connection
async function handleDelete(config) {
  if (!config.connections || config.connections.length === 0) {
    console.log(chalk.yellow('\n⚠️ No connection profiles configured yet.'));
    await pause();
    return;
  }

  const { profileName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'profileName',
      message: 'Select a connection profile to DELETE:',
      choices: config.connections.map(c => c.name)
    }
  ]);

  const { confirmDelete } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDelete',
      message: `Are you absolute sure you want to delete profile "${profileName}"? This cannot be undone.`,
      default: false
    }
  ]);

  if (confirmDelete) {
    config.connections = config.connections.filter(c => c.name !== profileName);
    if (saveConfig(config)) {
      console.log(chalk.green(`\n✓ VPN Profile "${profileName}" deleted.`));
    }
  } else {
    console.log(chalk.gray('\nDeletion canceled.'));
  }
  await pause();
}

// Start CLI
async function start() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args.length > 0) {
    const command = args[0].toLowerCase();
    
    if (command === 'connect' || command === 'c') {
      const profileName = args[1];
      if (!profileName) {
        console.log(chalk.yellow('\n⚠️ Please specify a profile name. Available profiles:'));
        if (config.connections && config.connections.length > 0) {
          config.connections.forEach(c => {
            console.log(`- ${chalk.bold(c.name)} (${c.description || 'No description'})`);
          });
          console.log(chalk.cyan('\nRun: ./index.js connect <profile-name>'));
        } else {
          console.log(chalk.red('No profiles found in config.json.'));
        }
        process.exit(1);
      }

      const conn = config.connections.find(c => c.name.toLowerCase() === profileName.toLowerCase());
      if (!conn) {
        console.error(chalk.red(`\n❌ Error: Profile "${profileName}" not found in config.json.`));
        process.exit(1);
      }

      try {
        await connectToProfile(conn, config);
      } catch (err) {
        console.error(chalk.red(`\n❌ Error: ${err.message}`));
      }
      process.exit(0);
    } else if (command === 'list' || command === 'l') {
      console.log(chalk.cyan(`\n📋 Configured VPN Profiles:`));
      if (config.connections && config.connections.length > 0) {
        config.connections.forEach(c => {
          const gw = c.gateway ? `${c.gateway}:${c.port || 443}` : (c.gateways ? c.gateways.map(g => `${g.host}:${g.port}`).join(', ') : 'None');
          console.log(`- ${chalk.bold(c.name)}: ${c.description || 'No description'}`);
          console.log(`  Gateway: ${gw}`);
          console.log(`  User:    ${c.username}`);
        });
      } else {
        console.log('No profiles found in config.json.');
      }
      process.exit(0);
    } else if (command === 'deps' || command === 'd') {
      console.log(chalk.bold('\n🔍 Checking system dependencies...'));
      const hasOpenForti = isBinaryInstalled('openfortivpn');
      const hasPppd = isBinaryInstalled('pppd');
      console.log(`- openfortivpn: ${hasOpenForti ? chalk.green('✔ Installed') : chalk.red('✘ Not Installed')}`);
      console.log(`- pppd (PPP daemon): ${hasPppd ? chalk.green('✔ Installed') : chalk.red('✘ Not Installed')}`);
      process.exit(0);
    } else {
      console.log(chalk.yellow(`\nUnknown command: ${command}`));
      console.log('Usage:');
      console.log('  ./index.js                    (Start interactive menu)');
      console.log('  ./index.js connect <profile>  (Connect directly to a profile)');
      console.log('  ./index.js list               (List all connection profiles)');
      console.log('  ./index.js deps               (Check system dependencies)');
      process.exit(1);
    }
  } else {
    mainMenu().catch(err => {
      console.error(chalk.red(`Fatal CLI error: ${err.message}`));
      process.exit(1);
    });
  }
}

start();
