const stringify = require("json-stringify-safe");

export default function handler(request, response) {
  return response.json(stringify(request));
}
