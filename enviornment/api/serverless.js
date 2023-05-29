const stringify = require("json-stringify-safe");

export default function handler(request, response) {
  const newHeaders = new Headers(request.headers);
  console.log(newHeaders);
  return response.json(stringify(request));
}
