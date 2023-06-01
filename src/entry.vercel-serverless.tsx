/* eslint-disable @typescript-eslint/consistent-type-imports */
import { createQwikCity } from "../fake_modules/qwik-city/middleware/vercel";
import qwikCityPlan from "@qwik-city-plan";
import render from "./entry.ssr";
import {
  getRequest,
  setResponse,
} from "../fake_modules/qwik-city/middleware/vercel/lib/vercel";

const DATA_SUFFIX = "/__data.json";
type IncomingMessage = import("http").IncomingMessage;
type ServerResponse = import("http").ServerResponse;

export default async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url) {
    const [path, search] = req.url.split("?");

    const params = new URLSearchParams(search);
    let pathname = params.get("__pathname");

    if (pathname) {
      params.delete("__pathname");
      // Optional routes' pathname replacements look like `/foo/$1/bar` which means we could end up with an url like /foo//bar
      pathname = pathname.replace(/\/+/g, "/");
      req.url = `${pathname}${
        path.endsWith(DATA_SUFFIX) ? DATA_SUFFIX : ""
      }?${params}`;
    }
  }

  let request: Request;
  try {
    request = await getRequest({
      base: `https://${req.headers.host}`,
      request: req,
    });
  } catch (err: any) {
    res.statusCode = /** @type {any} */ err.status || 400;
    return res.end("Invalid request body");
  }
  const vercelEdgeAdapter = createQwikCity({ render, qwikCityPlan });
  const response = await vercelEdgeAdapter(request);

  setResponse(res, response);
};
