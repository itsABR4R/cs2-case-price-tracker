const { spawn } = require('child_process');
const path = require('path');

// Start the server
const server = spawn('node', ['server.js'], {
    stdio: 'inherit'
});

console.log('🚀 Starting server...');

// Wait for 2 seconds to ensure server is up
setTimeout(() => {
    // Start the price fetcher
    const fetcher = spawn('node', ['fetchPrices.js'], {
        stdio: 'inherit'
    });

    console.log('📊 Starting price fetcher...');

    // Handle process termination
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        server.kill();
        fetcher.kill();
        process.exit();
    });

    // Handle fetcher completion
    fetcher.on('close', (code) => {
        console.log(`\n✨ Price fetcher completed with code ${code}`);
    });

}, 2000);

// Handle server errors
server.on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
}); 