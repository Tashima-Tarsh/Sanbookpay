import { startServer } from './server.js';

export function startSuperAdmin(port = null) {
  return startServer(port || Number(process.env.SUPER_ADMIN_PORT || 9000));
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startSuperAdmin();
}
