# 🛡️ FortiClient SSL VPN CLI Manager (Linux)

A lightweight, robust, and interactive terminal-based VPN connection manager for FortiClient SSL VPN on Linux. It uses the open-source `openfortivpn` backend to resolve the instability issues of the official FortiClient Linux application.

It supports traditional username/password authentication as well as **SAML Single Sign-On (SSO / Office 365)**.

---

## 📋 Features

- 🔌 **Direct Connection Commands**: Establish a tunnel with a single command (e.g. `./index.js connect yourvpn`).
- 🖥️ **Interactive Terminal UI**: Manage profiles easily via an arrow-key terminal menu.
- 🔑 **SAML SSO (Azure AD / Office 365) Support**: Handles browser-based federated login redirects.
- 🔒 **SSL Pinning Auto-Fetch**: Automatically fetches, verifies, and saves the gateway's TLS certificate fingerprint so you don't have to look it up manually.
- 🛡️ **Credential Cleanup**: plain-text passwords are temporarily used to spawn the connection and deleted immediately from disk.

---

## 🛠️ Step 1: System Installation

Since modern FortiGate setups use SAML/SSO, you require `openfortivpn` version **`1.23.0`** or newer. Because Ubuntu 24.04 repositories only carry the older `1.21.0` version, and the prebuilt `1.23` Debian packages have a package lock with the local `ppp` version, we build it directly from source.

Run the automated installer script provided in this folder:
```bash
./install_openfortivpn.sh
```
*This script will update your system package list, install compiler dependencies (`gcc`, `make`, `libssl-dev`, etc.), clone the official `openfortivpn` source code, compile it, and install it globally as `/usr/bin/openfortivpn`.*

---

## ⚙️ Step 2: Configuration

By default, your connection profiles are stored globally at:
`~/.config/forticlient/config.json`

### 📁 Custom Configuration Path
You can override the default configuration path by passing the `--config` (or `-c`) flag anywhere in your command arguments:
```bash
# Connect using a custom config file
./index.js --config /path/to/my-config.json connect yourvpn

# Or load the interactive menu with a custom config file
./index.js -c /path/to/my-config.json
```

---

### Example Profile (SAML SSO / Office 365)
If your VPN redirects you to a web browser to log in using an Office 365 account, use the following schema. Notice that `password` is omitted, and `saml` is set to `true`:
```json
{
  "connections": [
    {
      "name": "vpn name",
      "description": "description",
      "gateway": "",
      "port": 443,
      "username": "",
      "saml": true,
      "saml_port": 8020,
      "trusted_cert": "",
      "set_dns": true,
      "set_routes": true
    }
  ]
}
```

### Example Profile (Standard Password Login)
If you log in with a normal static password:
```json
{
  "connections": [
    {
      "name": "",
      "description": "Standard password VPN connection",
      "gateway": "",
      "port": 443,
      "username": "",
      "password": "",
      "trusted_cert": "",
      "set_dns": true,
      "set_routes": true
    }
  ]
}
```

### Configuration Parameters
| Parameter      | Type    | Default    | Description                                                                                              |
| :------------- | :------ | :--------- | :------------------------------------------------------------------------------------------------------- |
| `name`         | String  | *Required* | Name of the connection profile (used in commands).                                                       |
| `description`  | String  | `""`       | A helpful note about the profile.                                                                        |
| `gateway`      | String  | *Required* | Gateway domain/IP.                                                                                       |
| `port`         | Number  | `443`      | SSL VPN port.                                                                                            |
| `username`     | String  | *Required* | VPN Username (or email address for SAML SSO).                                                            |
| `saml`         | Boolean | `false`    | Set to `true` to enable SAML Single Sign-On.                                                             |
| `saml_port`    | Number  | `8020`     | Port configured on the FortiGate for browser loopback. Defaults to `8020`.                               |
| `password`     | String  | `""`       | Password (ignored if `saml` is `true`).                                                                  |
| `trusted_cert` | String  | `""`       | SHA-256 fingerprint. **Leave empty** on your first run; the script will fetch and save it automatically. |
| `set_dns`      | Boolean | `true`     | Update `/etc/resolv.conf` with DNS settings pushed by the server.                                        |
| `set_routes`   | Boolean | `true`     | Update local routing table with routes pushed by the server.                                             |

---

## 🚀 Step 3: Running the VPN

### A. Direct Execution (Recommended)
You can launch the connection directly from your terminal:
```bash
./index.js connect your-VPN
```

**What happens during SAML SSO connection:**
1. The tool automatically fetches and verifies the SSL certificate fingerprint.
2. It prints an authentication link in your terminal.
3. **Copy and paste this URL into your browser** and log in using your corporate account.
4. Once completed, your browser redirects back to `http://127.0.0.1:8020`.
5. The local `openfortivpn` agent captures the token and establishes the tunnel.

### B. Interactive Menu
To add, edit, delete, or inspect dependencies interactively:
```bash
./index.js
```
*(Or use `npm start`)*

---

## 🛑 Disconnecting
To close the VPN and restore your DNS and routing tables, press **`Ctrl + C`** in the terminal where the script is running.
