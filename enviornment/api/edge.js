export const config = {
  runtime: "edge",
};

export default (request, ctx) => {
  console.log("request", request);
  console.log("ctx", ctx);
  return new Response(
    `{request : ${JSON.stringify(request)}, context : ${JSON.stringify(ctx)}}`
  );
};
