const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

html = html.replace(
  /\s*<script src="https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0\/firebase-app-compat\.js" defer><\/script>\s*<script src="https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0\/firebase-auth-compat\.js" defer><\/script>\s*<script src="https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0\/firebase-database-compat\.js" defer><\/script>/,
  '\n  <script src="_fake-firebase.js"></script>'
);

html = html.replace(
  /<script>\s*if \('serviceWorker' in navigator\) \{\s*navigator\.serviceWorker\.register\('\/service-worker\.js'\);\s*\}\s*<\/script>/,
  ''
);

fs.writeFileSync('_test-harness.html', html);
console.log('Harness written. Contains fake-firebase swap:', html.includes('_fake-firebase.js'), 'SW stripped:', !html.includes('serviceWorker'));
