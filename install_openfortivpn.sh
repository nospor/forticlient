#!/bin/bash
# Exit immediately if any command fails
set -e

echo "=========================================="
echo "🛠️  Installing Dependencies for building openfortivpn..."
echo "=========================================="
sudo apt-get update
sudo apt-get install -y build-essential git autoconf automake pkg-config libssl-dev libsecret-1-dev

echo ""
echo "=========================================="
echo "📥 Cloning openfortivpn source (v1.23.1)..."
echo "=========================================="
rm -rf /tmp/openfortivpn-src
git clone --depth 1 --branch v1.23.1 https://github.com/adrienverge/openfortivpn.git /tmp/openfortivpn-src
cd /tmp/openfortivpn-src

echo ""
echo "=========================================="
echo "🏗️  Configuring and building..."
echo "=========================================="
./autogen.sh
./configure --prefix=/usr --sysconfdir=/etc
make

echo ""
echo "=========================================="
echo "💾 Installing globally..."
echo "=========================================="
sudo make install

echo ""
echo "=========================================="
echo "✅ Verification:"
echo "=========================================="
echo "Installed openfortivpn version: $(openfortivpn --version)"
echo "Location: $(which openfortivpn)"
echo "=========================================="
echo "Success! You can now run your VPN CLI manager."
