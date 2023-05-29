export const config = {
  runtime: "edge",
};

export default async (request) => {
  console.log(request.headers);
  return new Response(`hello ${request.url}`);
};
