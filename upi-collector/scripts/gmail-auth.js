'use strict';

const http = require('http');
const { google } = require('googleapis');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const PORT = 4242;

async function main() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('ERROR: Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first.');
    console.error('README: create a Google Cloud project, enable Gmail API, OAuth consent screen (Testing mode), add yourself as test user.');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, `http://127.0.0.1:${PORT}/`);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
    prompt: 'consent',
  });

  console.log('=== Gmail OAuth2 Consent ===');
  console.log('1. Open this URL in a browser:');
  console.log(authUrl);
  console.log('2. Sign in with your test user account and authorize.');
  console.log('3. You will be redirected to a local URL with a ?code= parameter.');
  console.log('Waiting for the callback on http://127.0.0.1:' + PORT + ' ...');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    res.writeHead(200, { 'Content-Type': 'text/html' });

    if (error) {
      res.end('<h1>OAuth Error</h1><p>' + error + '</p>');
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.end('<h1>No code received</h1>');
      return;
    }

    res.end('<h1>Authorized!</h1><p>You can close this tab and return to the terminal.</p>');

    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n=== REFRESH TOKEN ===');
      console.log(tokens.refresh_token);
      console.log('\nAdd this to .env:');
      console.log('GMAIL_REFRESH_TOKEN=' + tokens.refresh_token);
      console.log('\nScope: https://www.googleapis.com/auth/gmail.send (send-only)');
    } catch (e) {
      console.error('Token exchange failed:', e.message);
      process.exit(1);
    }

    setTimeout(() => server.close(), 500);
  });

  server.listen(PORT, '127.0.0.1');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
