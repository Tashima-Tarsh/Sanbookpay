import {HttpServer} from '../server.js';

// Legacy URLs share the canonical cookie/CSRF/TOTP identity system. Old bearer
// sessions remain historical records and cannot authorize new operations.
export function registerSuperAdminRoutes(server,ctx) {
  const base='/api/v1/super-admin',canonical='/api/platform/v1';
  const aliases=[
    ['POST','/login','/login'],['POST','/login/mfa','/login/mfa'],
    ['POST','/logout','/logout'],['GET','/verify-session','/me'],
    ['GET','/sessions','/sessions'],['POST','/sessions/revoke','/sessions/revoke'],
    ['POST','/mfa/enroll','/mfa/enroll'],['POST','/mfa/verify','/mfa/confirm'],
    ['GET','/merchants','/merchants'],['POST','/merchants','/merchants'],
    ['GET','/merchants/:id','/merchants/:id'],['POST','/merchants/:id/state','/merchants/:id/state'],
    ['GET','/receiving-banks','/connections'],['POST','/receiving-banks','/connections'],
    ['GET','/routing','/connections'],['GET','/routing/health','/operations/health']
  ];
  server.use(async(req,res,pathname)=>{
    if(!pathname.startsWith(base+'/'))return false;
    const relative=pathname.slice(base.length);
    for(const [method,source,destination] of aliases){
      const match=new RegExp('^'+source.replace(':id','([^/]+)')+'$').exec(relative);
      if(method!==req.method||!match)continue;
      const target=canonical+destination.replace(':id',match[1]||'');
      const url=new URL(req.url,'http://localhost');url.pathname=target;
      if(await ctx.platformIdentity.guard(req,res,target))return true;
      if(!['/login','/login/mfa'].includes(destination)&&!req.platform?.platform){HttpServer.json(res,403,{error:'Platform staff only'});return true;}
      const route=server.routes.find(r=>r.method===method&&r.regex.test(target));
      if(!route){HttpServer.json(res,503,{error:'Canonical platform service unavailable'});return true;}
      const previous=req.url;req.url=url.pathname+url.search;
      try{await route.handler(req,res,match[1]?{id:decodeURIComponent(match[1])}:{});}finally{req.url=previous;}
      return true;
    }
    HttpServer.json(res,410,{error:'Use the authenticated platform workspace and documented platform API.',workspace:'/platform'});return true;
  });
}
