import type { ServerRenderOptions } from "@builder.io/qwik-city/middleware/request-handler";
import type { IncomingMessage, ServerResponse } from "http";

/**
 * @public
 */
export declare function createQwikCity(
  opts: QwikCityVercelEdgeOptions
):
  | ((request: Request) => Promise<Response>)
  | ((req: IncomingMessage, res: ServerResponse) => Promise<any>);

/**
 * @public
 */
export declare interface PlatformVercel {}

/**
 * @public
 */
export declare interface QwikCityVercelEdgeOptions extends ServerRenderOptions {
  env?: "edge" | "serverless";
}

export {};
