const stringify = require("json-stringify-safe");

export default function handler(request, response) {
  const newHeaders = new Headers(request.headers);
  console.log(newHeaders);
  const edgeRequestObject = {
    ...request,
    headers: newHeaders,
  };
  return response.json(JSON.parse(stringify(edgeRequestObject)));
}
