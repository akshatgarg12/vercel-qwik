export const config = {
  runtime: "edge",
};

export default async (request) => {
  const req = await request.json();
  return new Response(JSON.stringify(req));
};
