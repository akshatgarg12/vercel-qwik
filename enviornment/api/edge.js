export const config = {
  runtime: "edge",
};

export default (request) => {
  console.log(request);
  return new Response(JSON.stringify(request));
};
