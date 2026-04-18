import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();

app.listen(config.port, config.host, () => {
  console.log(`WHOOP MCP server listening on http://${config.host}:${config.port}`);
}).on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});
