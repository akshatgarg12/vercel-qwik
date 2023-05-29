export const config = {
  runtime: "edge",
};

export default (request) => {
  return new Response(request);
};
