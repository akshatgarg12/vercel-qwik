import type { ViteDevServer, Connect } from 'vite';
import type { ServerResponse } from 'node:http';
import type { BuildContext } from '../types';
import type {
  ContentMenu,
  LoadedRoute,
  MenuData,
  MenuModule,
  MenuModuleLoader,
  PathParams,
  RequestEvent,
  RouteModule,
} from '../../runtime/src/types';
import type { QwikManifest, QwikViteDevResponse } from '@builder.io/qwik/optimizer';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import {
  getRouteMatchPathname,
  QDATA_JSON,
  runQwikCity,
} from '../../middleware/request-handler/user-response';
import { getQwikCityServerData } from '../../middleware/request-handler/response-page';
import { updateBuildContext } from '../build';
import { getExtension, normalizePath } from '../../utils/fs';
import { getMenuLoader, getPathParams } from '../../runtime/src/routing';
import { fromNodeHttp, getUrl } from '../../middleware/node/http';
import { resolveRequestHandlers } from '../../middleware/request-handler/resolve-request-handlers';
import { formatError } from './format-error';

export function ssrDevMiddleware(ctx: BuildContext, server: ViteDevServer) {
  const matchRouteRequest = (pathname: string) => {
    for (const route of ctx.routes) {
      const match = route.pattern.exec(pathname);
      if (match) {
        return {
          route,
          params: getPathParams(route.paramNames, match),
        };
      }
    }

    if (ctx.opts.trailingSlash && !pathname.endsWith('/')) {
      const pathnameWithSlash = pathname + '/';
      for (const route of ctx.routes) {
        const match = route.pattern.exec(pathnameWithSlash);
        if (match) {
          return {
            route,
            params: getPathParams(route.paramNames, match),
          };
        }
      }
    }

    return null;
  };

  return async (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    try {
      const url = getUrl(req);

      if (skipRequest(url.pathname) || isVitePing(url.pathname, req.headers)) {
        next();
        return;
      }

      await updateBuildContext(ctx);

      for (const d of ctx.diagnostics) {
        if (d.type === 'error') {
          console.error(d.message);
        } else {
          console.warn(d.message);
        }
      }

      const routeModulePaths = new WeakMap<RouteModule, string>();
      try {
        const { _deserializeData, _serializeData, _verifySerializable } =
          await server.ssrLoadModule('@qwik-serializer');
        const qwikSerializer = { _deserializeData, _serializeData, _verifySerializable };

        // use vite to dynamically load each layout/page module in this route's hierarchy

        const serverPlugins: RouteModule[] = [];
        for (const file of ctx.serverPlugins) {
          const layoutModule = await server.ssrLoadModule(file.filePath);
          serverPlugins.push(layoutModule);
          routeModulePaths.set(layoutModule, file.filePath);
        }

        const matchPathname = getRouteMatchPathname(url.pathname, ctx.opts.trailingSlash);
        const routeResult = matchRouteRequest(matchPathname);
        const routeModules: RouteModule[] = [];

        let params: PathParams = {};
        if (routeResult) {
          const route = routeResult.route;
          params = routeResult.params;

          // found a matching route
          for (const layout of route.layouts) {
            const layoutModule = await server.ssrLoadModule(layout.filePath);
            routeModules.push(layoutModule);
            routeModulePaths.set(layoutModule, layout.filePath);
          }
          const endpointModule = await server.ssrLoadModule(route.filePath);
          routeModules.push(endpointModule);
          routeModulePaths.set(endpointModule, route.filePath);
        }

        const renderFn = async (requestEv: RequestEvent) => {
          const isPageDataReq = requestEv.pathname.endsWith(QDATA_JSON);
          if (!isPageDataReq) {
            const serverData = getQwikCityServerData(requestEv);

            res.statusCode = requestEv.status();
            requestEv.headers.forEach((value, key) => {
              res.setHeader(key, value);
            });

            const cookieHeaders = requestEv.cookie.headers();
            if (cookieHeaders.length > 0) {
              res.setHeader('Set-Cookie', cookieHeaders);
            }

            const serverTiming = requestEv.sharedMap.get('@serverTiming') as
              | [string, number][]
              | undefined;
            if (serverTiming) {
              res.setHeader(
                'Server-Timing',
                serverTiming.map((a) => `${a[0]};dur=${a[1]}`).join(',')
              );
            }
            (res as QwikViteDevResponse)._qwikEnvData = {
              ...(res as QwikViteDevResponse)._qwikEnvData,
              ...serverData,
            };

            const qwikRenderPromise = new Promise<void>((resolve) => {
              (res as QwikViteDevResponse)._qwikRenderResolve = resolve;
            });

            next();

            return qwikRenderPromise;
          }
        };

        let menu: ContentMenu | undefined = undefined;
        const menus = ctx.menus.map((buildMenu) => {
          const menuLoader: MenuModuleLoader = async () => {
            const m = await server.ssrLoadModule(buildMenu.filePath);
            const menuModule: MenuModule = {
              default: m.default,
            };
            return menuModule;
          };
          const menuData: MenuData = [buildMenu.pathname, menuLoader];
          return menuData;
        });

        const menuLoader = getMenuLoader(menus, url.pathname);
        if (menuLoader) {
          const menuModule = await menuLoader();
          menu = menuModule?.default;
        }

        const loadedRoute = [params, routeModules, menu, undefined] satisfies LoadedRoute;
        const requestHandlers = resolveRequestHandlers(
          serverPlugins,
          loadedRoute,
          req.method ?? 'GET',
          false,
          renderFn
        );

        if (requestHandlers.length > 0) {
          const serverRequestEv = await fromNodeHttp(url, req, res, 'dev');
          Object.assign(serverRequestEv.platform, ctx.opts.platform);

          const manifest: QwikManifest = {
            symbols: {},
            mapping: {},
            bundles: {},
            injections: [],
            version: '1',
          };
          const { completion, requestEv } = runQwikCity(
            serverRequestEv,
            loadedRoute,
            requestHandlers,
            manifest,
            ctx.opts.trailingSlash,
            ctx.opts.basePathname,
            qwikSerializer
          );
          const result = await completion;
          if (result != null) {
            throw result;
          }

          if (requestEv.headersSent || res.headersSent) {
            return;
          }
        } else {
          // no matching route

          // test if this is a dev service-worker.js request
          for (const sw of ctx.serviceWorkers) {
            const match = sw.pattern.exec(req.originalUrl!);
            if (match) {
              res.setHeader('Content-Type', 'text/javascript');
              res.end(DEV_SERVICE_WORKER);
              return;
            }
          }
        }
      } catch (e: any) {
        if (e instanceof Error) {
          server.ssrFixStacktrace(e);
          formatError(e);
        }
        if (e instanceof Error && (e as any).id === 'DEV_SERIALIZE') {
          next(formatDevSerializeError(e, routeModulePaths));
        } else {
          next(e);
        }
        return;
      }

      // simple test if it's a static file
      const ext = getExtension(req.originalUrl!);
      if (STATIC_CONTENT_TYPES[ext]) {
        // let the static asset middleware handle this
        next();
        return;
      }

      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        /**
         * if no route match, but is html request, fast path to 404
         * otherwise qwik plugin will take over render without envData causing error
         */
        // TODO: after file change, need to manual page refresh to see changes currently
        //       there's two ways handling HMR for page endpoint with error
        // 1. Html response inject `import.meta.hot.accept('./pageEndpoint_FILE_URL', () => { location.reload })`
        // 2. watcher, diff previous & current file content, a bit expensive
        const html = getUnmatchedRouteHtml(url, ctx);
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }

      next();
    } catch (e) {
      next(e);
    }
  };
}

export function getUnmatchedRouteHtml(url: URL, ctx: BuildContext): string {
  const blue = '#006ce9';
  return `
  <html>
    <head>
      <meta charset="utf-8">
      <meta http-equiv="Status" content="404">
      <title>404 Not Found</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body { color: ${blue}; background-color: #fafafa; padding: 30px; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Roboto, sans-serif; }
        div, p { max-width: 70vw; margin: 60px auto 30px auto; background: white; border-radius: 4px; box-shadow: 0px 0px 50px -20px ${blue}; word-break: break-word; }
        div { display: flex; flex-direction: column; }
        strong { display: inline-block; padding: 15px; background: ${blue}; color: white; }
        span { display: inline-block; padding: 15px; }
        a { padding: 15px; }
        a:hover { background-color: rgba(0, 108, 233, 0.125); }
      </style>
    </head>
    <body>
      <p><strong>404</strong> <span>${url.pathname} not found.</span></p>
    
      <div>
        <strong>Available Routes</strong>
        
        ${ctx.routes.map((route) => `<a href="${route.pathname}">${route.pathname}</a>`).join('')}
      </div>
    </body>
  </html>`;
}

/**
 * Static file server for files written directly to the 'dist' dir.
 * Only handles the simplest cases.
 */
export function staticDistMiddleware({ config }: ViteDevServer) {
  const distDirs = new Set(
    ['dist', config.build.outDir, config.publicDir].map((d) =>
      normalizePath(resolve(config.root, d))
    )
  );

  return async (req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = new URL(req.originalUrl!, `http://${req.headers.host}`);

    if (skipRequest(url.pathname)) {
      next();
      return;
    }

    const relPath = url.pathname.slice(1);

    const ext = getExtension(relPath);
    const contentType = STATIC_CONTENT_TYPES[ext];
    if (!contentType) {
      next();
      return;
    }

    for (const distDir of distDirs) {
      try {
        const filePath = join(distDir, relPath);
        const s = await fs.promises.stat(filePath);
        if (s.isFile()) {
          res.writeHead(200, {
            'Content-Type': contentType,
            'X-Source-Path': filePath,
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      } catch (e) {
        //
      }
    }

    next();
  };
}

function formatDevSerializeError(err: any, routeModulePaths: WeakMap<RouteModule, string>) {
  const requestHandler = err.requestHandler;

  if (requestHandler?.name) {
    let errMessage = `Data returned from the ${requestHandler.name}() endpoint must be serializable `;
    errMessage += `so it can also be transferred over the network in an HTTP response. `;
    errMessage += `Please ensure that the data returned from ${requestHandler.name}() is limited to only strings, numbers, booleans, arrays or objects, and does not have any circular references. `;
    errMessage += `Error: ${err.message}`;
    err.message = errMessage;

    const endpointModule = err.endpointModule;
    const filePath = routeModulePaths.get(endpointModule);
    if (filePath) {
      try {
        const code = fs.readFileSync(filePath, 'utf-8');
        err.plugin = 'vite-plugin-qwik-city';
        err.id = normalizePath(filePath);
        err.loc = {
          file: err.id,
          line: undefined,
          column: undefined,
        };
        err.stack = '';
        const lines = code.split('\n');
        const line = lines.findIndex((line) => line.includes(requestHandler.name));
        if (line > -1) {
          err.loc.line = line + 1;
        }
      } catch (e) {
        // nothing
      }
    }
  }
  return err;
}

const FS_PREFIX = `/@fs/`;
const VALID_ID_PREFIX = `/@id/`;
const VITE_PUBLIC_PATH = `/@vite/`;
const internalPrefixes = [FS_PREFIX, VALID_ID_PREFIX, VITE_PUBLIC_PATH];
const InternalPrefixRE = new RegExp(`^(?:${internalPrefixes.join('|')})`);

function skipRequest(pathname: string) {
  if (pathname.startsWith('/@qwik-city-')) {
    return true;
  }
  if (
    pathname.includes('__open-in-editor') ||
    InternalPrefixRE.test(pathname) ||
    pathname.startsWith('/node_modules/')
  ) {
    return true;
  }
  if (pathname.includes('favicon')) {
    return true;
  }
  if (pathname.startsWith('/src/')) {
    const ext = getExtension(pathname);
    if (SKIP_SRC_EXTS[ext]) {
      return true;
    }
  }
  return false;
}

function isVitePing(url: string, headers: Connect.IncomingMessage['headers']) {
  return url === '/' && headers.accept === '*/*' && headers['sec-fetch-mode'] === 'no-cors';
}

const SKIP_SRC_EXTS: { [ext: string]: boolean } = {
  '.tsx': true,
  '.ts': true,
  '.jsx': true,
  '.js': true,
  '.md': true,
  '.mdx': true,
  '.css': true,
  '.scss': true,
  '.sass': true,
};

const STATIC_CONTENT_TYPES: { [ext: string]: string } = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const DEV_SERVICE_WORKER = `/* Qwik City Dev Service Worker */
addEventListener('install', () => self.skipWaiting());
addEventListener('activate', () => self.clients.claim());
`;