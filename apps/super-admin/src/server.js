import {startAdminServer} from '../../merchant-admin/src/index.js';

export function startServer(port=Number(process.env.SUPER_ADMIN_PORT||9000)){
  return startAdminServer(port);
}
