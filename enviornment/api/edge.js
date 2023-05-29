const stringify = require("json-stringify-safe");
export const config = {
  runtime: "edge",
};

export default (request) => {
  return new Response(stringify(request));
};
